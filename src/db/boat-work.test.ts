// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { readBoatWork } from "./boat-work";
import { bookings, nitroxCertifications, shops } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/**
 * **Nitrox asked for with no card that authorizes a fill** (issue #2549), read
 * live through the fill gate's own predicate. The warning on a departure's band
 * and Today's row both read this count, so each way a card can fail to count is
 * pinned here against a real database: pending, an import nobody confirmed, a
 * deleted card, another shop's card, and a verified one that does count.
 */
async function wantingNitrox() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, nowDate());
  const trip = upcoming.find((row) => row.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, trip.id);
  if (!entry) throw new Error("demo booking missing");
  await db.update(bookings).set({ wantsNitrox: true }).where(eq(bookings.id, entry.booking.id));
  // The demo diver may already hold a card: this file decides what they hold.
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.personId, entry.person.id));
  return { db, shop, trip, entry };
}

type Seat = Awaited<ReturnType<typeof wantingNitrox>>;

async function ungated(seat: Seat) {
  const work = await readBoatWork(
    seat.db,
    seat.shop.id,
    new Map([[seat.trip.id, [seat.entry.booking.id]]]),
  );
  return work.get(seat.trip.id)?.ungatedNitrox.map((diver) => diver.fullName) ?? [];
}

function card(seat: Seat, overrides: Partial<typeof nitroxCertifications.$inferInsert> = {}) {
  return seat.db.insert(nitroxCertifications).values({
    shopId: seat.shop.id,
    personId: seat.entry.person.id,
    agency: "padi",
    identifier: "NX-1",
    status: "verified",
    reviewedAt: nowDate(),
    ...overrides,
  });
}

describe("readBoatWork: ungated nitrox", () => {
  it("counts a diver who wants nitrox and holds no card", async () => {
    const seat = await wantingNitrox();
    expect(await ungated(seat)).toEqual([seat.entry.person.fullName]);
  });

  it("does not count a diver who never asked", async () => {
    const seat = await wantingNitrox();
    await seat.db
      .update(bookings)
      .set({ wantsNitrox: false })
      .where(eq(bookings.id, seat.entry.booking.id));
    expect(await ungated(seat)).toEqual([]);
  });

  it("does not count a diver with a verified card", async () => {
    const seat = await wantingNitrox();
    await card(seat);
    expect(await ungated(seat)).toEqual([]);
  });

  it("still counts a card nobody has verified", async () => {
    const seat = await wantingNitrox();
    await card(seat, { status: "pending", reviewedAt: null });
    expect(await ungated(seat)).toEqual([seat.entry.person.fullName]);
  });

  it("still counts an imported card nobody has confirmed, and not one that was confirmed", async () => {
    const seat = await wantingNitrox();
    await card(seat, { importedAt: nowDate(), reviewedAt: null });
    expect(await ungated(seat)).toEqual([seat.entry.person.fullName]);

    await seat.db
      .update(nitroxCertifications)
      .set({ reviewedAt: nowDate() })
      .where(eq(nitroxCertifications.personId, seat.entry.person.id));
    expect(await ungated(seat)).toEqual([]);
  });

  it("still counts a card that was deleted", async () => {
    const seat = await wantingNitrox();
    await card(seat, { deletedAt: new Date(nowDate().getTime() - DAY_MS) });
    expect(await ungated(seat)).toEqual([seat.entry.person.fullName]);
  });

  it("still counts a diver whose only card belongs to another shop", async () => {
    const seat = await wantingNitrox();
    const [other] = await seat.db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-boat-work", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    await card(seat, { shopId: other.id });
    expect(await ungated(seat)).toEqual([seat.entry.person.fullName]);
  });

  it("counts a diver once however many cards they hold", async () => {
    const seat = await wantingNitrox();
    await card(seat, { identifier: "NX-A" });
    await card(seat, { identifier: "NX-B", agency: "ssi" });
    expect(await ungated(seat)).toEqual([]);
    await seat.db.delete(nitroxCertifications);
    await card(seat, { identifier: "NX-C", status: "pending", reviewedAt: null });
    await card(seat, { identifier: "NX-D", agency: "ssi", status: "pending", reviewedAt: null });
    expect(await ungated(seat)).toEqual([seat.entry.person.fullName]);
  });

  it("is a database fact that only a diver can ask for nitrox, so a snorkeler or rider never counts", async () => {
    const seat = await wantingNitrox();
    for (const participantType of ["snorkeler", "rider"] as const) {
      await expect(
        seat.db.transaction(async (tx) => {
          await tx
            .update(bookings)
            .set({ participantType })
            .where(eq(bookings.id, seat.entry.booking.id));
        }),
      ).rejects.toThrow();
    }
  });
});
