// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate, nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { getDiverProfile } from "./divers";
import { listTripsReadiness, upsertTripRequirements } from "./readiness";
import { bookings, trips, waiverRecords } from "./schema";
import { issuePartySeatClaims } from "./seat-claims";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";
import { recordInPersonWaiver } from "./waivers-in-person";

const ctx = fileScopedShopContext();

/**
 * **Every door reads a seat's release where the roster does** (issue #2611).
 * A release signed 350 days ago stands today and runs out before a trip three
 * weeks away: the roster blocks that seat ("runs out before the trip"), so a
 * fresh link, a paper copy and a party panel must all treat it as owed now, and
 * the new signature must clear the roster.
 */
async function seat(kind: "diver" | "rider" = "diver") {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  await upsertTripRequirements(db, {
    shopId: shop.id,
    tripId: reef.id,
    requiresWaiver: true,
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: false,
  });
  if (kind === "rider") {
    await db
      .update(bookings)
      .set({ participantType: "rider" })
      .where(eq(bookings.id, entry.booking.id));
  }
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
  if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.token, {
    signerName: entry.person.fullName,
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  if (!done.ok) throw new Error("waiver completion failed");
  return { db, shop, reef, entry };
}

type Seat = Awaited<ReturnType<typeof seat>>;

/** Re-date the diver's signature so it runs out at `lapsesAt`. */
async function lapseAt(s: Seat, lapsesAt: Date) {
  const signedAt = new Date(lapsesAt.getTime() - WAIVER_SIGNATURE_VALIDITY_MS);
  await s.db
    .update(waiverRecords)
    .set({ signedAt, completedAt: signedAt })
    .where(eq(waiverRecords.personId, s.entry.person.id));
}

/** Midway between now and the trip's start: valid today, gone before the trip. */
const beforeTheTrip = (s: Seat) => new Date((nowMs() + s.reef.startsAt.getTime()) / 2);

async function codes(s: Seat) {
  const rows = await listTripsReadiness(s.db, s.shop.id, [s.reef.id]);
  const row = rows.find((r) => r.booking.id === s.entry.booking.id);
  if (!row) throw new Error("seat missing from the roster");
  return row.readiness.blockers.map((b) => b.code);
}

async function staffId(s: Seat) {
  const [staff] = await listStaff(s.db, s.shop.id);
  if (!staff) throw new Error("demo staff missing");
  return staff.person.id;
}

describe.each(["diver", "rider"] as const)(
  "a %s's release that runs out before the trip",
  (kind) => {
    it("is blocked on the roster, and a fresh link is issued now, not refused as already completed", async () => {
      const s = await seat(kind);
      await lapseAt(s, beforeTheTrip(s));
      expect(await codes(s)).toEqual(["waiver_runs_out"]);

      const issued = await issueWaiverRequest(s.db, {
        shopId: s.shop.id,
        bookingId: s.entry.booking.id,
      });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      const done = await completeWaiver(s.db, issued.token, {
        signerName: s.entry.person.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      });
      expect(done.ok).toBe(true);
      expect(await codes(s)).toEqual([]);
    });

    it("is replaced by a paper copy, which clears the roster", async () => {
      const s = await seat(kind);
      await lapseAt(s, beforeTheTrip(s));
      const outcome = await recordInPersonWaiver(s.db, {
        shopId: s.shop.id,
        subject: { bookingId: s.entry.booking.id },
        recordedByPersonId: await staffId(s),
        medicalAttested: true,
      });
      expect(outcome).toMatchObject({ ok: true, alreadySigned: false });
      expect(await codes(s)).toEqual([]);

      const live = await s.db
        .select({ id: waiverRecords.id })
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, s.entry.booking.id));
      // One live record per seat: the lapsed one is retired, not left beside it.
      const unsuperseded = await s.db
        .select({ id: waiverRecords.id, supersededAt: waiverRecords.supersededAt })
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, s.entry.booking.id));
      expect(live.length).toBeGreaterThan(1);
      expect(unsuperseded.filter((r) => r.supersededAt === null)).toHaveLength(1);
    });

    it("keeps answering 'already completed' for a release that outlasts the trip", async () => {
      const s = await seat(kind);
      await lapseAt(s, new Date(s.reef.endsAt.getTime() + DAY_MS));
      expect(await codes(s)).toEqual([]);

      expect(
        await issueWaiverRequest(s.db, { shopId: s.shop.id, bookingId: s.entry.booking.id }),
      ).toEqual({ ok: false, reason: "already_completed" });
      expect(
        await recordInPersonWaiver(s.db, {
          shopId: s.shop.id,
          subject: { bookingId: s.entry.booking.id },
          recordedByPersonId: await staffId(s),
          medicalAttested: true,
        }),
      ).toMatchObject({ ok: true, alreadySigned: true });
    });
  },
);

describe("a release that lapses after the trip is over", () => {
  it("is not owed a new signature: the door and the roster agree", async () => {
    const s = await seat();
    await lapseAt(s, new Date(s.reef.endsAt.getTime() + 1));
    expect(await codes(s)).toEqual([]);
    expect(
      await issueWaiverRequest(s.db, { shopId: s.shop.id, bookingId: s.entry.booking.id }),
    ).toEqual({ ok: false, reason: "already_completed" });
  });
});

describe("a multi-day trip already under way", () => {
  it("reads at now: the guest is ready, and no new link is owed", async () => {
    const s = await seat();
    const startedAt = new Date(nowMs() - DAY_MS);
    const endsAt = new Date(nowMs() + 5 * DAY_MS);
    await s.db
      .update(trips)
      .set({ startsAt: startedAt, endsAt, revision: 99 }) // diveday:allow-flat-revision: test fixture
      .where(eq(trips.id, s.reef.id));
    // Valid today, runs out on day four of the six the boat is out.
    await lapseAt(s, new Date(nowMs() + 2 * DAY_MS));

    expect(await codes(s)).toEqual([]);
    expect(
      await issueWaiverRequest(s.db, { shopId: s.shop.id, bookingId: s.entry.booking.id }),
    ).toEqual({ ok: false, reason: "already_completed" });
  });
});

describe("a party panel", () => {
  it("does not call a seat signed on a release that runs out before the trip", async () => {
    const s = await seat();
    const party = await createBookingParty(s.db, [
      {
        actor: "public",
        shopId: s.shop.id,
        tripId: s.reef.id,
        fullName: "Orla Organizer",
        email: "orla@example.com",
      },
      { actor: "public", shopId: s.shop.id, tripId: s.reef.id, fullName: "Milo Member" },
    ]);
    if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
    const [lead, member] = party.bookings;
    if (!lead || !member) throw new Error("party incomplete");

    const signedAt = new Date(beforeTheTrip(s).getTime() - WAIVER_SIGNATURE_VALIDITY_MS);
    const issued = await issueWaiverRequest(s.db, {
      shopId: s.shop.id,
      bookingId: member.bookingId,
    });
    if (!issued.ok) throw new Error("waiver setup failed");
    await s.db
      .update(waiverRecords)
      .set({
        status: "completed",
        signedName: "Milo Member",
        signatureMethod: "typed",
        signedAt,
        completedAt: signedAt,
      })
      .where(eq(waiverRecords.bookingId, member.bookingId));

    const seats = await issuePartySeatClaims(s.db, {
      shopId: s.shop.id,
      leadBookingId: lead.bookingId,
      now: nowDate(),
    });
    expect(seats.find((entry) => entry.bookingId === member.bookingId)?.waiverSigned).toBe(false);
  });
});

describe("the diver record", () => {
  it("says the release runs out before the trip while it stands today, as the roster does", async () => {
    const s = await seat();
    await lapseAt(s, beforeTheTrip(s));
    const profile = await getDiverProfile(s.db, s.shop.id, s.entry.person.id);
    expect(profile?.waiver).toMatchObject({ state: "current", runsOutBeforeTrip: true });

    // The record reads the furthest upcoming seat, so the other seats go.
    const others = await s.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.personId, s.entry.person.id));
    for (const other of others.filter((row) => row.id !== s.entry.booking.id)) {
      await s.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, other.id));
    }
    await lapseAt(s, new Date(s.reef.endsAt.getTime() + DAY_MS));
    const after = await getDiverProfile(s.db, s.shop.id, s.entry.person.id);
    expect(after?.waiver).toMatchObject({ state: "current", runsOutBeforeTrip: false });
  });
});
