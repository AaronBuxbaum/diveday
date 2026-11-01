import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking, moveBooking } from "./bookings";
import type { AppDb } from "./client";
import { hasMoveAsk, pagedInboxMessages, recordMoveAsk } from "./inbound-messages";
import { MOVE_OFFER_CANDIDATES, strandedMoveAsk, strandedMoveOffer } from "./move-offer";
import { shops, trips } from "./schema";
import { createTrip, setTripStatus } from "./trips";

/**
 * **The one boat a called-off seat is offered** (UX sheet 2026-10-22, item 5;
 * H-20261022-called-off-boat-offers): same kind, same shop, same price or lower, a seat free, not yet
 * left. Every exclusion is proved by a boat that would otherwise win, because
 * it is sooner than the one that qualifies.
 *
 * The stranded seat pays 10.00, below anything the demo shop sells, so no
 * seeded departure can qualify by accident.
 */

const ctx = fileScopedShopContext();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAID = 1_000;

async function departure(
  db: AppDb,
  shopId: string,
  title: string,
  inMs: number,
  extra: { priceCents?: number; capacity?: number; isPrivate?: boolean } = {},
) {
  const startsAt = new Date(nowMs() + inMs);
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: extra.capacity ?? 6,
    plannedDives: 2,
    priceCents: extra.priceCents ?? PAID,
    isPrivate: extra.isPrivate,
  });
  if (!trip) throw new Error(`creating ${title} failed`);
  return trip;
}

async function seat(db: AppDb, shopId: string, tripId: string, fullName: string) {
  const booked = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName,
    email: `${fullName.toLowerCase().replace(/\W+/g, "-")}@example.com`,
  });
  if (!booked.ok) throw new Error(`seating ${fullName} failed: ${booked.reason}`);
  return booked;
}

/** Nora's seat on a departure the shop then calls off. */
async function stranded() {
  const { db, shop } = ctx;
  const off = await departure(db, shop.id, "Called-off reef", 2 * DAY_MS);
  const nora = await seat(db, shop.id, off.id, "Nora Quinn");
  await setTripStatus(db, shop.id, off.id, "cancelled");
  return { db, shop, off, nora };
}

const offerFor = (db: AppDb, shopId: string, bookingId: string) =>
  strandedMoveOffer(db, { shopId, bookingId, now: new Date(nowMs()) });

describe("strandedMoveOffer", () => {
  it("offers the soonest boat of the same kind at the same price or lower with a seat free", async () => {
    const { db, shop, nora } = await stranded();
    const later = await departure(db, shop.id, "Reef, later", 6 * DAY_MS);
    const sooner = await departure(db, shop.id, "Reef, sooner", 4 * DAY_MS, { priceCents: 800 });
    expect(later.id).not.toBe(sooner.id);
    expect(await offerFor(db, shop.id, nora.bookingId)).toEqual({
      tripId: sooner.id,
      title: "Reef, sooner",
      startsAt: sooner.startsAt,
    });
  });

  it("passes over a pricier, a full, a private and an already-left boat, and another shop's", async () => {
    const { db, shop, nora } = await stranded();
    await departure(db, shop.id, "Pricier", 3 * HOUR_MS, { priceCents: PAID + 1 });
    const full = await departure(db, shop.id, "Full", 4 * HOUR_MS, { capacity: 1 });
    await seat(db, shop.id, full.id, "Pia Ortiz");
    await departure(db, shop.id, "Private", 5 * HOUR_MS, { isPrivate: true });
    await departure(db, shop.id, "Already left", -2 * HOUR_MS);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-move-offer", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    await departure(db, other.id, "Theirs", 6 * HOUR_MS);
    const ours = await departure(db, shop.id, "Ours", 5 * DAY_MS);

    expect((await offerFor(db, shop.id, nora.bookingId))?.tripId).toBe(ours.id);
  });

  it("weighs only the next few departures that could be offered, soonest first", async () => {
    const { db, shop, nora } = await stranded();
    // Each passes the SQL narrowing and fails an exact check after it: no
    // seat left for a diver.
    for (let i = 0; i < MOVE_OFFER_CANDIDATES; i += 1) {
      const boat = await departure(db, shop.id, `No diver seats ${i}`, (i + 1) * HOUR_MS);
      await db.update(trips).set({ diverCapacity: 1 }).where(eq(trips.id, boat.id));
      await seat(db, shop.id, boat.id, `Diver ${i}`);
    }
    // Qualifies, but sits past the cap: nothing is offered rather than more read.
    await departure(db, shop.id, "Past the cap", 5 * DAY_MS);
    expect(await offerFor(db, shop.id, nora.bookingId)).toBeNull();
  });

  it("offers nothing when no boat qualifies", async () => {
    const { db, shop, nora } = await stranded();
    await departure(db, shop.id, "Pricier", 3 * DAY_MS, { priceCents: PAID + 500 });
    expect(await offerFor(db, shop.id, nora.bookingId)).toBeNull();
  });

  it("offers nothing on a departure that still runs, or for a seat read through another shop", async () => {
    const { db, shop } = ctx;
    const running = await departure(db, shop.id, "Still running", 2 * DAY_MS);
    const kai = await seat(db, shop.id, running.id, "Kai Moana");
    await departure(db, shop.id, "Elsewhere", 4 * DAY_MS);
    expect(await offerFor(db, shop.id, kai.bookingId)).toBeNull();

    const { nora } = await stranded();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-move-offer-2", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    expect(await offerFor(db, other.id, nora.bookingId)).toBeNull();
  });

  it("passes over a boat the diver already holds a seat on", async () => {
    const { db, shop, nora } = await stranded();
    const mine = await departure(db, shop.id, "Already mine", 3 * DAY_MS);
    const again = await seat(db, shop.id, mine.id, "Nora Quinn");
    expect(again.personId).toBe(nora.personId);
    const next = await departure(db, shop.id, "Next", 5 * DAY_MS);
    expect((await offerFor(db, shop.id, nora.bookingId))?.tripId).toBe(next.id);
  });
});

describe("the ask from the cancelled card", () => {
  it("lands in the desk's move queue, and the desk's own move answers it", async () => {
    const { db, shop, off, nora } = await stranded();
    const target = await departure(db, shop.id, "Reef, Thursday", 3 * DAY_MS);
    const now = new Date(nowMs());
    expect(await strandedMoveAsk(db, { shopId: shop.id, bookingId: nora.bookingId, now })).toEqual({
      state: "open",
      offer: { tripId: target.id, title: target.title, startsAt: target.startsAt },
    });

    // An ordinary ask refuses a seat on a cancelled departure; the card's ask is for exactly that.
    expect(await recordMoveAsk(db, { shopId: shop.id, bookingId: nora.bookingId, now })).toEqual({
      status: "not_found",
    });
    const filed = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId: nora.bookingId,
      calledOff: true,
      note: "Please move me to Reef, Thursday.",
      now,
    });
    if (filed.status !== "recorded") throw new Error(`expected recorded, got ${filed.status}`);
    const inbox = await pagedInboxMessages(db, shop.id, { page: 1 });
    expect(inbox.rows.find((row) => row.message.id === filed.id)?.message).toMatchObject({
      keywordIntent: "move",
      bookingId: nora.bookingId,
      answeredAt: null,
      body: "Please move me to Reef, Thursday.",
    });
    // Asked once: the card says so instead of offering it again.
    expect(await strandedMoveAsk(db, { shopId: shop.id, bookingId: nora.bookingId, now })).toEqual({
      state: "asked",
    });

    expect(
      await moveBooking(db, {
        shopId: shop.id,
        fromTripId: off.id,
        toTripId: target.id,
        bookingId: nora.bookingId,
      }),
    ).toMatchObject({ ok: true, owedCents: 0 });
    expect(await hasMoveAsk(db, shop.id, nora.bookingId)).toBe(false);
  });
});
