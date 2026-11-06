import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { signingDate } from "@/lib/guardian";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  getCounterDoctorReferral,
  getPartyWaiverQueue,
  issuePartyWaiver,
} from "./party-waiver-queue";
import * as readinessDb from "./readiness";
import { listTripReadiness } from "./readiness";
import {
  activityEvents,
  bookings,
  capabilities,
  people,
  personRoles,
  waiverRecords,
} from "./schema";
import { seatParty } from "./seat-diver";
import { upcomingTripsWithCounts } from "./trips";
import { completeWaiver, doorNeedsDeskGuardian, getWaiverForToken } from "./waivers-completion";
import { recordMedicalEvaluation } from "./waivers-medical";
import { clearAnswers, medicalReferralAnswers, openOnDevice } from "./waivers-test-fixtures";

const ctx = fileScopedShopContext();

/** What `/waivers/<token>` opens for a counter link: its state, or unavailable. */
async function opened(db: typeof ctx.db, token: string, now?: Date) {
  const door = await openOnDevice(db, token, now);
  if (door?.door !== "counter") return { state: "unavailable" as const };
  return getWaiverForToken(db, door.key, now);
}

/** Sign through the counter link, as the tablet's form does. */
async function signAtCounter(
  db: typeof ctx.db,
  token: string,
  input: Parameters<typeof completeWaiver>[2],
) {
  const door = await openOnDevice(db, token);
  if (door?.door !== "counter") return { ok: false as const, reason: "no_door" as const };
  return completeWaiver(db, door.key, input);
}

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
    entry: "roster",
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
  return { db, shop, trip, lead, minor, third, staff, stamp };
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

  it("shows a solo seat its own counter code: a one-seat queue (issue 3984)", async () => {
    const f = await family();
    const solo = await createBooking(f.db, {
      actor: "staff",
      shopId: f.shop.id,
      tripId: f.trip.id,
      fullName: `Solo ${f.stamp}`,
    });
    if (!solo.ok) throw new Error("solo seat refused");
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: solo.bookingId,
    };
    const queue = await getPartyWaiverQueue(f.db, input);
    expect(queue?.members.map((member) => member.bookingId)).toEqual([solo.bookingId]);
    const issued = await issuePartyWaiver(f.db, {
      ...input,
      bookingId: solo.bookingId,
      actorPersonId: f.staff.id,
    });
    if (!issued || !("token" in issued)) throw new Error("solo code refused");
    expect(await opened(f.db, issued.token)).toMatchObject({
      state: "available",
      record: { bookingId: solo.bookingId },
    });
  });

  it("records on the diver's trail which staffer showed the code (security S2)", async () => {
    const f = await family();
    const issued = await issuePartyWaiver(f.db, {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.third.bookingId,
      actorPersonId: f.staff.id,
    });
    if (!issued || !("token" in issued)) throw new Error("link missing");
    const lines = await f.db
      .select({ actor: activityEvents.actorPersonId, subject: activityEvents.subjectPersonId })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.shopId, f.shop.id),
          eq(activityEvents.code, "waiver_counter_code_shown"),
        ),
      );
    expect(lines).toEqual([{ actor: f.staff.id, subject: f.third.personId }]);
  });

  it("issues only the clicked seat's link and keeps guardian consent required", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.minor.bookingId,
      actorPersonId: f.staff.id,
      guardianPresent: true,
    };
    const issued = await issuePartyWaiver(f.db, input);
    if (!issued || !("token" in issued)) throw new Error("eligible minor refused");
    const state = await opened(f.db, issued.token);
    expect(state).toMatchObject({ state: "available", record: { bookingId: f.minor.bookingId } });
    expect(
      await signAtCounter(f.db, issued.token, {
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

  describe("a minor at the counter needs a staff check that a guardian is here (#3986)", () => {
    const guardianLines = (f: Awaited<ReturnType<typeof family>>) =>
      f.db
        .select({ actor: activityEvents.actorPersonId, subject: activityEvents.subjectPersonId })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.shopId, f.shop.id),
            eq(activityEvents.code, "waiver_counter_guardian_confirmed"),
          ),
        );

    it("shows no code for a minor until the desk confirms a guardian is present", async () => {
      const f = await family();
      const input = {
        shopId: f.shop.id,
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
        bookingId: f.minor.bookingId,
        actorPersonId: f.staff.id,
      };
      for (const guardianPresent of [undefined, false]) {
        expect(await issuePartyWaiver(f.db, { ...input, guardianPresent })).toEqual({
          guardianCheck: true,
        });
      }
      const minted = await f.db
        .select({ id: capabilities.id })
        .from(capabilities)
        .innerJoin(waiverRecords, eq(waiverRecords.id, capabilities.waiverRecordId))
        .where(eq(waiverRecords.bookingId, f.minor.bookingId));
      expect(minted).toEqual([]);
      expect(await guardianLines(f)).toEqual([]);

      const issued = await issuePartyWaiver(f.db, { ...input, guardianPresent: true });
      if (!issued || !("token" in issued)) throw new Error("confirmed minor refused");
      // Who confirmed it is on the minor's trail, beside who showed the code.
      expect(await guardianLines(f)).toEqual([{ actor: f.staff.id, subject: f.minor.personId }]);
    });

    it("asks nothing of an adult's code", async () => {
      const f = await family();
      const issued = await issuePartyWaiver(f.db, {
        shopId: f.shop.id,
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
        bookingId: f.third.bookingId,
        actorPersonId: f.staff.id,
      });
      expect(issued && "token" in issued).toBe(true);
      expect(await guardianLines(f)).toEqual([]);
    });

    it("asks again at signing: a code shown for an adult signs no minor's release (#4003)", async () => {
      const f = await family();
      const issued = await issuePartyWaiver(f.db, {
        shopId: f.shop.id,
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
        bookingId: f.third.bookingId,
        actorPersonId: f.staff.id,
      });
      if (!issued || !("token" in issued)) throw new Error("adult code refused");
      // Under 18, said after the code was shown and before it was signed.
      await f.db
        .update(bookings)
        .set({ minorDeclaredAt: nowDate() })
        .where(eq(bookings.id, f.third.bookingId));
      expect(
        await signAtCounter(f.db, issued.token, {
          signerName: `Leo ${f.stamp}`,
          agreed: true,
          medicalAnswers: clearAnswers,
          guardian: { name: "Rosa Guardian", relationship: "parent", email: "", agreed: true },
        }),
      ).toEqual({ ok: false, reason: "guardian_at_counter" });
    });

    it("signs a minor's release on a code the desk confirmed a guardian for", async () => {
      const f = await family();
      const issued = await issuePartyWaiver(f.db, {
        shopId: f.shop.id,
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
        bookingId: f.minor.bookingId,
        actorPersonId: f.staff.id,
        guardianPresent: true,
      });
      if (!issued || !("token" in issued)) throw new Error("confirmed minor refused");
      const door = await openOnDevice(f.db, issued.token);
      if (door?.door !== "counter") throw new Error("code does not open");
      expect(await doorNeedsDeskGuardian(f.db, door.key)).toBe(false);
      expect(
        await signAtCounter(f.db, issued.token, {
          signerName: `Mia ${f.stamp}`,
          agreed: true,
          medicalAnswers: clearAnswers,
          guardian: { name: "Rosa Guardian", relationship: "parent", email: "", agreed: true },
        }),
      ).toMatchObject({ ok: true });
    });
  });

  it("a fresh counter code leaves the one open on the diver's phone working", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.third.bookingId,
      actorPersonId: f.staff.id,
    };
    const first = await issuePartyWaiver(f.db, input);
    if (!first || !("token" in first)) throw new Error("counter code missing");
    // The diver's phone opens it, then the desk shows the code again.
    expect((await opened(f.db, first.token)).state).toBe("available");
    const second = await issuePartyWaiver(f.db, input);
    if (!second || !("token" in second)) throw new Error("second code missing");
    expect(second.token).not.toBe(first.token);
    expect((await opened(f.db, first.token)).state).toBe("available");
    expect((await opened(f.db, second.token)).state).toBe("available");
    // Whichever signs, the other then opens nothing.
    expect(
      await signAtCounter(f.db, first.token, {
        signerName: `Leo ${f.stamp}`,
        agreed: true,
        medicalAnswers: clearAnswers,
      }),
    ).toMatchObject({ ok: true });
    expect((await opened(f.db, second.token)).state).toBe("unavailable");
  });

  it("refuses to issue after a seat is held or cancelled", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.minor.bookingId,
      actorPersonId: f.staff.id,
      guardianPresent: true,
    };
    const existing = await issuePartyWaiver(f.db, input);
    if (!existing || !("token" in existing)) throw new Error("link missing");
    await f.db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Mia" })
      .where(eq(bookings.id, f.minor.bookingId));
    expect(await issuePartyWaiver(f.db, input)).toBeNull();
    // A held seat's counter link opens nothing, as its thread does not.
    expect((await opened(f.db, existing.token)).state).toBe("unavailable");
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
    // A cancelled seat has no release to sign, on the counter as in the thread.
    expect((await opened(f.db, existing.token)).state).toBe("unavailable");
  });
  it("never revives an expired or superseded QR and issues a fresh one", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.third.bookingId,
      actorPersonId: f.staff.id,
    };
    const first = await issuePartyWaiver(f.db, input);
    if (!first || !("token" in first)) throw new Error("first link missing");
    expect(first.expiresAt.getTime() - nowDate().getTime()).toBeLessThanOrEqual(30 * 60_000);
    expect((await opened(f.db, first.token)).state).toBe("available");
    expect((await opened(f.db, first.token, first.expiresAt)).state).toBe("unavailable");
    const next = await issuePartyWaiver(f.db, input);
    if (!next || !("token" in next)) throw new Error("fresh link missing");
    expect(next.token).not.toBe(first.token);
    expect((await opened(f.db, first.token, first.expiresAt)).state).toBe("unavailable");
    expect((await opened(f.db, next.token)).state).toBe("available");
    await f.db
      .update(waiverRecords)
      .set({ supersededAt: nowDate() })
      .where(eq(waiverRecords.bookingId, f.third.bookingId));
    expect(await opened(f.db, next.token)).toEqual({ state: "unavailable" });
  });
  it("reports the waiver signed without claiming other readiness blockers are clear", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.third.bookingId,
      actorPersonId: f.staff.id,
    };
    const issued = await issuePartyWaiver(f.db, input);
    if (!issued || !("token" in issued)) throw new Error("link missing");
    const result = await signAtCounter(f.db, issued.token, {
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
  it("spends the counter link on signing and keeps only its receipt until it expires", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.lead.bookingId,
      actorPersonId: f.staff.id,
    };
    const issued = await issuePartyWaiver(f.db, input);
    if (!issued || !("token" in issued)) throw new Error("link missing");
    expect((await opened(f.db, issued.token)).state).toBe("available");
    expect(
      (
        await signAtCounter(f.db, issued.token, {
          signerName: `Ana ${f.stamp}`,
          agreed: true,
          medicalAnswers: clearAnswers,
        })
      ).ok,
    ).toBe(true);
    const [link] = await f.db
      .select({ usedAt: capabilities.usedAt })
      .from(capabilities)
      .where(eq(capabilities.tokenHash, hashBearerToken(issued.token)));
    expect(link?.usedAt).not.toBeNull();
    expect((await opened(f.db, issued.token)).state).toBe("completed");
    expect((await opened(f.db, issued.token, new Date(issued.expiresAt.getTime() + 1))).state).toBe(
      "unavailable",
    );
    await f.db
      .update(waiverRecords)
      .set({ supersededAt: nowDate() })
      .where(eq(waiverRecords.bookingId, f.lead.bookingId));
    expect((await opened(f.db, issued.token)).state).toBe("unavailable");
  });
  it("distinguishes a pending medical review from a physician's refusal", async () => {
    const f = await family();
    const input = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.lead.bookingId,
      bookingId: f.lead.bookingId,
      actorPersonId: f.staff.id,
    };
    const issued = await issuePartyWaiver(f.db, input);
    if (!issued || !("token" in issued)) throw new Error("link missing");
    const signed = await signAtCounter(f.db, issued.token, {
      signerName: `Ana ${f.stamp}`,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
    });
    expect(signed).toMatchObject({ ok: true, status: "medical_review" });
    // The desk can print the physician form for it (issue #3984), and its
    // answers never reach the paper.
    expect(await getCounterDoctorReferral(f.db, input)).toMatchObject({
      fullName: `Ana ${f.stamp}`,
      answers: "whole",
    });
    expect(
      await getCounterDoctorReferral(f.db, { ...input, bookingId: f.third.bookingId }),
    ).toBeNull();
    expect(
      await getCounterDoctorReferral(f.db, { ...input, shopId: crypto.randomUUID() }),
    ).toBeNull();
    expect(
      await getCounterDoctorReferral(f.db, { ...input, tripId: crypto.randomUUID() }),
    ).toBeNull();
    let queue = await getPartyWaiverQueue(f.db, input);
    expect(queue?.members.find((member) => member.bookingId === f.lead.bookingId)).toMatchObject({
      state: "medical_review",
      medicalState: "review",
    });
    const [booking] = await f.db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, f.lead.bookingId));
    if (!booking) throw new Error("booking missing");
    const evaluated = await recordMedicalEvaluation(f.db, {
      outcome: "not_cleared",
      shopId: f.shop.id,
      timeZone: f.shop.timezone,
      personId: booking.personId,
      recordedByPersonId: f.staff.id,
      evaluatedOn: signingDate(nowDate(), f.shop.timezone),
      physicianName: "Dr. Example",
    });
    expect(evaluated.ok).toBe(true);
    queue = await getPartyWaiverQueue(f.db, input);
    expect(queue?.members.find((member) => member.bookingId === f.lead.bookingId)).toMatchObject({
      state: "medical_not_cleared",
      medicalState: "not_cleared",
    });
    // A physician's answer is in: nothing left to print.
    expect(await getCounterDoctorReferral(f.db, input)).toBeNull();
  });
  it("keeps a refusal visible when a fresh waiver is also needed", async () => {
    const f = await family();
    const rows = await listTripReadiness(f.db, f.shop.id, f.trip.id, nowDate());
    const changed = rows.map((row) =>
      row.booking.id === f.lead.bookingId
        ? {
            ...row,
            readiness: {
              ...row.readiness,
              blockers: [
                ...row.readiness.blockers,
                { code: "waiver_pending" as const },
                { code: "medical_not_cleared" as const },
              ],
            },
          }
        : row,
    );
    const spy = vi.spyOn(readinessDb, "listTripReadiness").mockResolvedValue(changed);
    try {
      const queue = await getPartyWaiverQueue(f.db, {
        shopId: f.shop.id,
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
      });
      expect(queue?.members.find((member) => member.bookingId === f.lead.bookingId)).toMatchObject({
        state: "needed",
        medicalState: "not_cleared",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("names a held seat only by what was booked, and orders the party lead-first whatever order readiness returns", async () => {
    const f = await family();
    await f.db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: null })
      .where(eq(bookings.id, f.third.bookingId));
    const rows = await listTripReadiness(f.db, f.shop.id, f.trip.id, nowDate());
    const reversed = [...rows].reverse();
    const spy = vi.spyOn(readinessDb, "listTripReadiness").mockResolvedValue(reversed);
    try {
      const queue = await getPartyWaiverQueue(f.db, {
        shopId: f.shop.id,
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
      });
      expect(queue?.members[0]?.bookingId).toBe(f.lead.bookingId);
      expect(queue?.members.find((m) => m.bookingId === f.third.bookingId)).toMatchObject({
        state: "held",
        name: null,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("never calls a seat signed when its requirement is unknown, and says plainly when none is needed", async () => {
    const f = await family();
    const rows = await listTripReadiness(f.db, f.shop.id, f.trip.id, nowDate());
    const changed = rows.map((row) => {
      if (row.booking.id === f.minor.bookingId) return { ...row, requirement: null };
      if (row.booking.id === f.third.bookingId && row.requirement)
        return { ...row, requirement: { ...row.requirement, requiresWaiver: false } };
      return row;
    });
    const spy = vi.spyOn(readinessDb, "listTripReadiness").mockResolvedValue(changed);
    try {
      const queue = await getPartyWaiverQueue(f.db, {
        shopId: f.shop.id,
        tripId: f.trip.id,
        leadBookingId: f.lead.bookingId,
      });
      expect(queue?.members.find((m) => m.bookingId === f.minor.bookingId)?.state).toBe("unknown");
      expect(queue?.members.find((m) => m.bookingId === f.third.bookingId)?.state).toBe(
        "not_required",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
