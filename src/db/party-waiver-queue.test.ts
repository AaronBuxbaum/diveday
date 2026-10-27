import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { sealCounterWaiverToken } from "@/lib/counter-waiver-token";
import { fileScopedShopContext } from "@/test/db";
import { getPartyWaiverQueue, issuePartyWaiver } from "./party-waiver-queue";
import { listTripReadiness } from "./readiness";
import { bookings, people, personRoles, waiverRecords } from "./schema";
import { seatParty } from "./seat-diver";
import { upcomingTripsWithCounts } from "./trips";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { clearAnswers } from "./waivers-test-fixtures";

const ctx = fileScopedShopContext();

async function family() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((item) => item.title === "Two-Tank Reef — Christ of the Abyss");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!trip || !staff) throw new Error("seeded trip or staff missing");
  const stamp = crypto.randomUUID().slice(0, 8);
  const result = await seatParty(db, {
    shopId: shop.id,
    tripId: trip.id,
    actorPersonId: staff.id,
    entry: "walk_in",
    refusals: "specific",
    members: [
      { fullName: `Ana ${stamp}`, minor: false },
      { fullName: `Mia ${stamp}`, minor: true },
      { fullName: `Leo ${stamp}`, minor: false },
    ],
  });
  if (!result.ok || result.seats.length !== 3) throw new Error("family not seated");
  const [lead, minor, third] = result.seats;
  if (!lead || !minor || !third) throw new Error("family missing");
  return { db, shop, trip, lead, minor, third, stamp };
}

describe("party release QR handoff", () => {
  it("lists only the selected party, keeps the minor's guardian step, and does not call signed releases ready", async () => {
    const f = await family();
    const queue = await getPartyWaiverQueue(f.db, {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
    });
    if (!queue) throw new Error("queue missing");
    expect(queue.members.map((member) => member.bookingId)).toEqual(
      expect.arrayContaining([f.lead.bookingId, f.minor.bookingId, f.third.bookingId]),
    );
    expect(queue.members).toHaveLength(3);
    expect(queue.members.find((member) => member.bookingId === f.minor.bookingId)).toMatchObject({
      guardianRequired: true,
    });
    expect(JSON.stringify(queue)).not.toContain("/waivers/");
    expect(
      await getPartyWaiverQueue(f.db, {
        shopId: crypto.randomUUID(),
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
      }),
    ).toBeNull();
  });

  it("issues only the clicked seat's link and keeps guardian consent required", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.minor.bookingId,
    };
    const issued = await issuePartyWaiver(f.db, input);
    if (!issued) throw new Error("eligible minor refused");
    const state = await getWaiverForToken(f.db, issued.token);
    expect(state).toMatchObject({ state: "available", record: { bookingId: f.minor.bookingId } });
    expect(
      await completeWaiver(f.db, issued.token, {
        signerName: `Mia ${f.stamp}`,
        agreed: true,
        medicalAnswers: clearAnswers,
      }),
    ).toEqual({ ok: false, reason: "guardian_required" });
    expect(
      await issuePartyWaiver(f.db, { ...input, leadBookingId: crypto.randomUUID() }),
    ).toBeNull();
    expect(await issuePartyWaiver(f.db, { ...input, tripId: crypto.randomUUID() })).toBeNull();
    expect(await issuePartyWaiver(f.db, { ...input, shopId: crypto.randomUUID() })).toBeNull();
  });

  it("refuses to issue after a seat is held or cancelled", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.minor.bookingId,
    };
    const existing = await issuePartyWaiver(f.db, input);
    if (!existing) throw new Error("link missing");
    await f.db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Mia" })
      .where(eq(bookings.id, f.minor.bookingId));
    expect(await issuePartyWaiver(f.db, input)).toBeNull();
    expect((await getWaiverForToken(f.db, existing.token)).state).toBe("held");
    const queue = await getPartyWaiverQueue(f.db, input);
    expect(queue?.members.find((member) => member.bookingId === f.minor.bookingId)).toMatchObject({
      state: "held",
      name: "Mia",
    });
    await f.db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, status: "cancelled" })
      .where(eq(bookings.id, f.minor.bookingId));
    expect(await issuePartyWaiver(f.db, input)).toBeNull();
    // Existing waiver links intentionally retain their current cancellation policy.
    expect((await getWaiverForToken(f.db, existing.token)).state).toBe("available");
  });
  it("never revives an expired or superseded QR and issues a fresh one", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.third.bookingId,
    };
    const first = await issuePartyWaiver(f.db, input);
    if (!first) throw new Error("first link missing");
    await f.db
      .update(waiverRecords)
      .set({ expiresAt: new Date(nowDate().getTime() - 1000) })
      .where(eq(waiverRecords.bookingId, f.third.bookingId));
    expect((await getWaiverForToken(f.db, first.token)).state).toBe("expired");
    const next = await issuePartyWaiver(f.db, input);
    if (!next) throw new Error("replacement link missing");
    expect(next.token).not.toBe(first.token);
    expect(await getWaiverForToken(f.db, first.token)).toEqual({ state: "unavailable" });
    await f.db
      .update(waiverRecords)
      .set({ supersededAt: nowDate(), tokenSealed: null })
      .where(eq(waiverRecords.bookingId, f.third.bookingId));
    expect(await getWaiverForToken(f.db, next.token)).toEqual({ state: "unavailable" });
  });
  it("reports the waiver signed without claiming other readiness blockers are clear", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.third.bookingId,
    };
    const issued = await issuePartyWaiver(f.db, input);
    if (!issued) throw new Error("link missing");
    const result = await completeWaiver(f.db, issued.token, {
      signerName: `Leo ${f.stamp}`,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    expect(result.ok).toBe(true);
    const queue = await getPartyWaiverQueue(f.db, input);
    expect(queue?.members.find((member) => member.bookingId === f.third.bookingId)?.state).toBe(
      "signed",
    );
    expect(await issuePartyWaiver(f.db, input)).toBeNull();
    const rows = await listTripReadiness(f.db, f.shop.id, f.trip.id, nowDate());
    expect(
      rows.find((row) => row.booking.id === f.third.bookingId)?.readiness.blockers.length,
    ).toBeGreaterThan(0);
  });
  it("keeps a waiver-only envelope scoped and expiring after the lead signs", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.lead.bookingId,
    };
    const issued = await issuePartyWaiver(f.db, input);
    if (!issued) throw new Error("link missing");
    const envelope = sealCounterWaiverToken(issued.token, issued.expiresAt);
    if (!envelope) throw new Error("envelope missing");
    expect(envelope).not.toContain(issued.token);
    expect((await getWaiverForToken(f.db, envelope)).state).toBe("available");
    expect(
      (
        await completeWaiver(f.db, envelope, {
          signerName: `Ana ${f.stamp}`,
          agreed: true,
          medicalAnswers: clearAnswers,
        })
      ).ok,
    ).toBe(true);
    expect((await getWaiverForToken(f.db, envelope)).state).toBe("completed");
    expect(
      (await getWaiverForToken(f.db, envelope, new Date(issued.expiresAt.getTime() + 1))).state,
    ).toBe("unavailable");
    expect(
      (await getWaiverForToken(f.db, issued.token, new Date(issued.expiresAt.getTime() + 1))).state,
    ).toBe("completed");
    await f.db
      .update(waiverRecords)
      .set({ supersededAt: nowDate() })
      .where(eq(waiverRecords.bookingId, f.lead.bookingId));
    expect((await getWaiverForToken(f.db, envelope)).state).toBe("unavailable");
  });
});
