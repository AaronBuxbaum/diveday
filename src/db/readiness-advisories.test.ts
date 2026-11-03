import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  createCertification,
  listTripReadiness,
  reviewCertification,
  upsertTripRequirements,
} from "./readiness";
import { bookings, cards, diveSites, shops } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

/**
 * **Advisories never gate boarding** (ADR 20261103-advisory-is-a-finding): at
 * the database edge, a site's depth moves only a seat's `advisories`, never its
 * readiness, and a seat with nothing to measure says nothing.
 */
const ctx = fileScopedShopContext();

async function fixture({ card }: { card: boolean }) {
  const { db, shop } = ctx;
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
    trip.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("trip missing");
  const [seat] = await getTripRoster(db, shop.id, reef.id);
  if (!seat) throw new Error("seat missing");
  await db.update(shops).set({ depthUnit: "meters" }).where(eq(shops.id, shop.id));
  if (!card) {
    // A card on file but none verified: a certification blocker, and no ceiling.
    await db
      .update(cards)
      .set({ status: "pending" })
      .where(
        and(eq(cards.kind, "level"), eq(cards.shopId, shop.id), eq(cards.personId, seat.person.id)),
      );
  } else {
    const created = await createCertification(db, {
      shopId: shop.id,
      personId: seat.person.id,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-ADVISORY-OW",
    });
    if (!created) throw new Error("card missing");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: created.id,
      status: "verified",
    });
  }
  const read = async (meters: number) => {
    await db
      .update(diveSites)
      .set({ maxDepthMeters: meters, depthMinMeters: null })
      .where(eq(diveSites.shopId, shop.id));
    const row = (await listTripReadiness(db, shop.id, reef.id)).find(
      (candidate) => candidate.booking.id === seat.booking.id,
    );
    if (!row) throw new Error("seat missing from readiness");
    return row;
  };
  return { db, shop, reef, seat, read };
}

it("leaves readiness exactly as it was when only the site's depth changes", async () => {
  const { read } = await fixture({ card: true });
  const deep = await read(30);
  expect(deep.advisories.map((advisory) => advisory.code)).toContain("depth_exceeds_ceiling");
  const shallow = await read(10);
  expect(shallow.advisories.map((advisory) => advisory.code)).not.toContain(
    "depth_exceeds_ceiling",
  );
  expect(deep.readiness).toEqual(shallow.readiness);
});

it("says nothing about depth to a rider or a snorkeler on a deep trip", async () => {
  const { db, seat, read } = await fixture({ card: true });
  for (const participantType of ["rider", "snorkeler"] as const) {
    await db.update(bookings).set({ participantType }).where(eq(bookings.id, seat.booking.id));
    expect((await read(30)).advisories).toEqual([]);
  }
});

it("adds no depth line under a diver already blocked for having no verified card", async () => {
  const { db, shop, reef, read } = await fixture({ card: false });
  await upsertTripRequirements(db, {
    shopId: shop.id,
    tripId: reef.id,
    requiresWaiver: false,
    minimumCertificationLevel: "open_water",
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: false,
  });
  const row = await read(30);
  expect(row.readiness.status).toBe("blocked");
  expect(row.advisories.map((advisory) => advisory.code)).not.toContain("depth_exceeds_ceiling");
});
