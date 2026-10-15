import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people, shops, tripWaitlistEntries } from "./schema";
import { listCertificationSummaries } from "./self-declared-cards";
import {
  getTripRoster,
  getTripWaitlist,
  getTripWithBooked,
  getWaitlistEntryForTrip,
  upcomingTripsWithCounts,
} from "./trips";
import { inviteWaitlistDiver, joinTripWaitlist, recordWaitlistInvite } from "./waitlist";

async function seededContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  const openTrip = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!fullTrip || !openTrip) throw new Error("expected seeded trips missing");
  return { db, shop, fullTrip, openTrip };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("joinTripWaitlist (in-memory PGlite)", () => {
  it("adds a new diver to a full trip without consuming a seat", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
    });

    expect(outcome).toMatchObject({ ok: true, personName: "Nora Quinn" });
    expect(await getTripRoster(db, shop.id, fullTrip.id)).toHaveLength(fullTrip.capacity);
  });

  it("keeps one entry per diver and trip, dated when they first asked", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const first = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    const again = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      email: "NORA@example.com",
    });

    expect(first).toMatchObject({ ok: true });
    expect(again).toMatchObject({
      ok: false,
      reason: "already_waitlisted",
      entryId: first.entryId,
    });
  });

  /**
   * The wait-list half of H-13's borrowed-identity rule — see the twin in
   * `last-minute-list.test.ts` for why a certification is the one write on this
   * unauthenticated fork that a mismatched name has to stop.
   */
  it("does not write a declaration onto a person whose name does not match", async () => {
    const { db, shop, fullTrip } = await seededContext();
    await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      declaration: { level: "open_water", noCertification: false, nitrox: false },
    });
    const [person] = await db.select().from(people).where(eq(people.email, visitor.email));
    if (!person) throw new Error("setup: joiner not created");

    const again = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      email: visitor.email,
      fullName: "Someone Else Entirely",
      declaration: { level: "instructor", noCertification: false, nitrox: true },
    });

    // The entry side is unchanged — a second submission on an existing entry is
    // `already_waitlisted` either way. Only the evidence write is gated.
    expect(again).toMatchObject({ ok: false, reason: "already_waitlisted" });
    const profile = (await listCertificationSummaries(db, shop.id, [person.id])).get(person.id);
    expect(profile?.level).toBe("open_water");
    expect(profile?.nitrox).toBe(false);
  });

  it("refuses a wait-list entry while a spot is available", async () => {
    const { db, shop, openTrip } = await seededContext();
    await expect(
      joinTripWaitlist(db, { shopId: shop.id, tripId: openTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
    const trip = await getTripWithBooked(db, shop.id, openTrip.id);
    expect(trip?.booked).toBe(openTrip.booked);
  });

  /**
   * **The same full/not-full decision the booking door makes** — `seatHeld`,
   * not "every status but cancelled" (issue #1209).
   *
   * The counter can release a seat from the dock call onwards, which is inside
   * the window this form is still open in. Counting the released row as held
   * would put a diver on a lead list for a boat `createBooking` would have
   * sold them outright, and the two doors would be saying opposite things
   * about the same departure at the same moment.
   */
  it("sends a diver to book rather than to wait, once a seat is released", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const roster = await getTripRoster(db, shop.id, fullTrip.id);
    const released = roster[0];
    if (!released) throw new Error("expected the full trip to have a roster");
    await db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, released.booking.id));

    await expect(
      joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
  });
});

/**
 * **A wait-list party** (fourth UX review, item 34; ADR 20260719-trip-waitlist,
 * amended): a couple waits together for the full Saturday as one entry of two,
 * and a boat with one seat left is still full for them.
 */
describe("joinTripWaitlist for a party", () => {
  async function entry(id: string | undefined) {
    if (!id) throw new Error("expected an entry");
    const [row] = await ctx.db
      .select()
      .from(tripWaitlistEntries)
      .where(eq(tripWaitlistEntries.id, id));
    return row;
  }

  it("records the party on one entry", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 2,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect((await entry(outcome.entryId))?.partySize).toBe(2);
  });

  it("waits a pair on a boat with one seat left, and sends one diver to book it", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const [released] = await getTripRoster(db, shop.id, fullTrip.id);
    if (!released) throw new Error("expected the full trip to have a roster");
    await db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, released.booking.id));

    await expect(
      joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
    const pair = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 2,
    });
    expect(pair).toMatchObject({ ok: true });
  });

  it("updates the party when the joiner asks again", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const first = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    const again = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 3,
    });
    expect(again).toMatchObject({
      ok: false,
      reason: "already_waitlisted",
      entryId: first.entryId,
    });
    expect((await entry(first.entryId))?.partySize).toBe(3);
  });

  /**
   * The form says "up to the boat's seats", and the server holds it there: a
   * hand-posted party of twenty on a smaller boat would otherwise count twenty
   * seats of demand on the staff roster (security review r4-4, F1).
   */
  it("holds a party larger than the boat to the boat's seats", async () => {
    const { db, shop, fullTrip } = await seededContext();
    expect(fullTrip.capacity).toBeLessThan(20);
    const outcome = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: fullTrip.capacity + 5,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect((await entry(outcome.entryId))?.partySize).toBe(fullTrip.capacity);

    await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 99,
    });
    expect((await entry(outcome.entryId))?.partySize).toBe(fullTrip.capacity);
  });
});

describe("recordWaitlistInvite", () => {
  it("stamps an entry as invited, scoped to the shop, and is idempotent", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const joined = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);

    const findEntry = async () =>
      (await getTripWaitlist(db, shop.id, fullTrip.id)).find(
        (row) => row.entry.id === joined.entryId,
      );

    const t0 = new Date("2026-07-21T10:00:00.000Z");
    await expect(
      recordWaitlistInvite(db, { shopId: shop.id, entryId: joined.entryId, now: t0 }),
    ).resolves.toBe(true);
    expect((await findEntry())?.entry.invitedAt?.toISOString()).toBe(t0.toISOString());

    // A re-invite just moves the timestamp forward (no double-entry).
    const t1 = new Date("2026-07-21T12:00:00.000Z");
    await recordWaitlistInvite(db, { shopId: shop.id, entryId: joined.entryId, now: t1 });
    expect((await findEntry())?.entry.invitedAt?.toISOString()).toBe(t1.toISOString());
  });

  it("refuses to stamp an entry from another shop", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const joined = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);
    await expect(
      recordWaitlistInvite(db, {
        shopId: "00000000-0000-4000-8000-000000000099",
        entryId: joined.entryId,
      }),
    ).resolves.toBe(false);
  });
});

describe("inviteWaitlistDiver", () => {
  it("stamps the entry and reports the composer fallback when email isn't configured", async () => {
    // The test environment sets neither APP_HOST nor SES_*, so a real send
    // can't happen and the delivery degrades to the fallback — while the invite
    // is still durably recorded.
    const { db, shop, fullTrip } = await seededContext();
    const joined = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);

    const now = new Date("2026-07-21T10:00:00.000Z");
    const result = await inviteWaitlistDiver(db, {
      shopId: shop.id,
      shopSlug: "blue-mantis",
      entryId: joined.entryId,
      now,
    });

    expect(result).toEqual({ ok: true, delivery: "unconfigured", invitedAt: now });
    const entry = (await getTripWaitlist(db, shop.id, fullTrip.id)).find(
      (row) => row.entry.id === joined.entryId,
    );
    expect(entry?.entry.invitedAt?.toISOString()).toBe(now.toISOString());
  });

  it("reports opted_out and skips the send for a diver who self-served out of courtesy email", async () => {
    // Leo — self-serve email unsubscribe: `waitlist_invite` is one of the two
    // kinds `people.courtesyEmailOptOutAt` governs, so an opted-out diver
    // still gets stamped invited (their held seat is real) but the composer
    // fallback stands in for the automated email that never goes out.
    const { db, shop, fullTrip } = await seededContext();
    const joined = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);
    await db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.email, visitor.email));

    const now = new Date("2026-07-21T10:00:00.000Z");
    const result = await inviteWaitlistDiver(db, {
      shopId: shop.id,
      shopSlug: "blue-mantis",
      entryId: joined.entryId,
      now,
    });

    expect(result).toEqual({ ok: true, delivery: "opted_out", invitedAt: now });
  });

  it("does not stamp or invite an entry from another shop", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const joined = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);

    await expect(
      inviteWaitlistDiver(db, {
        shopId: "00000000-0000-4000-8000-000000000099",
        shopSlug: "blue-mantis",
        entryId: joined.entryId,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });

    const entry = (await getTripWaitlist(db, shop.id, fullTrip.id)).find(
      (row) => row.entry.id === joined.entryId,
    );
    expect(entry?.entry.invitedAt).toBeNull();
  });
});

describe("getTripWaitlist / getWaitlistEntryForTrip cross-tenant isolation (CR-007)", () => {
  it("neither shop can read the other's real wait-list entry by substituting its own trip/entry id", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-waitlist-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    const joined = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);

    // A genuinely different shop, its own trip, its own real entry — not a
    // hardcoded placeholder id — so this proves the query rejects a real
    // mismatched shop_id, not just an id that matches nothing at all.
    const otherTrips = await upcomingTripsWithCounts(db, otherShop.id);
    expect(otherTrips).toEqual([]); // a fresh shop has no seeded trips of its own

    // otherShop's session can't see shop's entry at all.
    expect(await getTripWaitlist(db, otherShop.id, fullTrip.id)).toEqual([]);
    expect(await getWaitlistEntryForTrip(db, otherShop.id, fullTrip.id, joined.entryId)).toBeNull();

    // shop's own session still can, unaffected by the other shop existing.
    expect(await getWaitlistEntryForTrip(db, shop.id, fullTrip.id, joined.entryId)).not.toBeNull();
  });
});
