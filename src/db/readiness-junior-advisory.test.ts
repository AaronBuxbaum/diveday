import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  createCertification,
  listTripReadiness,
  reviewCertification,
  upsertTripRequirements,
} from "./readiness";
import { cards, diveSites, people, shops } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();
async function fixture() {
  const { db, shop } = ctx;
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
    trip.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("trip missing");
  const [seat] = await getTripRoster(db, shop.id, reef.id);
  if (!seat) throw new Error("seat missing");
  await db
    .update(diveSites)
    .set({ maxDepthMeters: null, depthMinMeters: null })
    .where(eq(diveSites.shopId, shop.id));
  await db.update(shops).set({ depthUnit: "meters" }).where(eq(shops.id, shop.id));
  const card = await createCertification(db, {
    shopId: shop.id,
    personId: seat.person.id,
    agency: "padi",
    level: "open_water",
    identifier: "PADI-DEPTH-OW",
  });
  if (!card) throw new Error("card missing");
  await reviewCertification(db, { shopId: shop.id, certificationId: card.id, status: "verified" });
  return { db, shop, reef, seat, card };
}

it("keeps the junior advisory when a young diver has no verified card or site depth", async () => {
  const { db, shop, reef, seat } = await fixture();
  await db.update(people).set({ dateOfBirth: "2015-01-01" }).where(eq(people.id, seat.person.id));
  await db
    .update(cards)
    .set({ status: "pending" })
    .where(
      and(eq(cards.shopId, shop.id), eq(cards.personId, seat.person.id), eq(cards.kind, "level")),
    );
  const diver = (await listTripReadiness(db, shop.id, reef.id)).find(
    (row) => row.booking.id === seat.booking.id,
  );
  expect(diver?.advisories).toMatchObject([
    {
      code: "depth_verification_required",
      params: {
        verificationReasons: ["junior_limits"],
      },
    },
  ]);
  expect(diver?.readiness.blockers.some((blocker) => blocker.code.includes("depth"))).toBe(false);
});

it("keeps age and supervision checks visible without a verified card, birthday, or site depth", async () => {
  const { db, shop, reef, seat } = await fixture();
  await upsertTripRequirements(db, {
    shopId: shop.id,
    tripId: reef.id,
    requiresWaiver: false,
    minimumCertificationLevel: "open_water",
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: false,
  });
  await db.update(people).set({ dateOfBirth: null }).where(eq(people.id, seat.person.id));
  await db
    .update(cards)
    .set({ status: "pending" })
    .where(
      and(eq(cards.shopId, shop.id), eq(cards.personId, seat.person.id), eq(cards.kind, "level")),
    );
  const diver = (await listTripReadiness(db, shop.id, reef.id)).find(
    (row) => row.booking.id === seat.booking.id,
  );
  expect(diver?.advisories).toMatchObject([
    {
      code: "depth_verification_required",
      params: {
        verificationReasons: ["junior_limits"],
      },
    },
  ]);
  expect(diver?.readiness.blockers).toContainEqual(
    expect.objectContaining({ code: "certification_pending" }),
  );
  expect(diver?.readiness.blockers.some((blocker) => blocker.code.includes("depth"))).toBe(false);
});

it("keeps the PADI junior advisory when date of birth and site depth are missing", async () => {
  const { db, shop, reef, seat, card } = await fixture();
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("staff missing");
  await db.update(people).set({ dateOfBirth: null }).where(eq(people.id, seat.person.id));
  await db
    .update(cards)
    .set({
      juniorStatus: "junior",
      juniorStatusVerifiedAt: nowDate(),
      juniorStatusVerifiedByPersonId: staff.person.id,
    })
    .where(and(eq(cards.id, card.id), eq(cards.kind, "level")));
  const diver = (await listTripReadiness(db, shop.id, reef.id)).find(
    (row) => row.booking.id === seat.booking.id,
  );
  expect(diver?.advisories).toMatchObject([
    {
      code: "depth_verification_required",
      params: {
        verificationReasons: expect.arrayContaining(["junior_limits"]),
      },
    },
  ]);
  expect(diver?.readiness.blockers.some((blocker) => blocker.code.includes("depth"))).toBe(false);
});

it("keeps unclassified PADI Advanced card and age checks visible without gating boarding", async () => {
  const { db, shop, reef, seat, card } = await fixture();
  await db.update(people).set({ dateOfBirth: null }).where(eq(people.id, seat.person.id));
  await db
    .update(cards)
    .set({ level: "advanced_open_water" })
    .where(and(eq(cards.id, card.id), eq(cards.kind, "level")));
  for (const depth of [25, null]) {
    await db.update(diveSites).set({ maxDepthMeters: depth }).where(eq(diveSites.shopId, shop.id));
    const diver = (await listTripReadiness(db, shop.id, reef.id)).find(
      (row) => row.booking.id === seat.booking.id,
    );
    expect(diver?.advisories).toMatchObject([
      {
        code: "depth_verification_required",
        params: {
          verificationReasons: ["card_status", "junior_limits"],
        },
      },
    ]);
    expect(diver?.readiness.blockers.some((blocker) => blocker.code.includes("depth"))).toBe(false);
  }
});

it("keeps unclassified PADI card evidence visible for a known adult without gating boarding", async () => {
  const { db, shop, reef, seat, card } = await fixture();
  await db.update(people).set({ dateOfBirth: "1990-01-01" }).where(eq(people.id, seat.person.id));
  await db
    .update(cards)
    .set({ level: "advanced_open_water" })
    .where(and(eq(cards.id, card.id), eq(cards.kind, "level")));
  for (const depth of [12, 25, null]) {
    await db.update(diveSites).set({ maxDepthMeters: depth }).where(eq(diveSites.shopId, shop.id));
    const diver = (await listTripReadiness(db, shop.id, reef.id)).find(
      (row) => row.booking.id === seat.booking.id,
    );
    expect(diver?.advisories).toMatchObject([
      {
        code: "depth_verification_required",
        params: {
          verificationReasons: expect.arrayContaining(["card_status"]),
        },
      },
    ]);
    expect(diver?.readiness.blockers.some((blocker) => blocker.code.includes("depth"))).toBe(false);
  }
});
