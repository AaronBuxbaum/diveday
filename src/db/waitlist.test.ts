// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  getTripRoster,
  getTripWaitlist,
  getTripWithBooked,
  upcomingTripsWithCounts,
} from "./trips";
import { inviteWaitlistDiver, joinTripWaitlist, recordWaitlistInvite } from "./waitlist";

async function seededContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  const openTrip = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!fullTrip || !openTrip) throw new Error("expected seeded trips missing");
  return { db, shop, fullTrip, openTrip };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

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

  it("keeps one first-come entry per diver and trip", async () => {
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

  it("refuses a wait-list entry while a spot is available", async () => {
    const { db, shop, openTrip } = await seededContext();
    await expect(
      joinTripWaitlist(db, { shopId: shop.id, tripId: openTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
    const trip = await getTripWithBooked(db, shop.id, openTrip.id);
    expect(trip?.booked).toBe(openTrip.booked);
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
    // The test environment sets neither APP_HOST nor RESEND_*, so a real send
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
