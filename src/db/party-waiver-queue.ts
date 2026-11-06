import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { guardianSignatureMissing, guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { hasReturned } from "@/lib/trips";
import { endOfLocalDay } from "@/lib/zoned";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { mintCapability } from "./capabilities";
import type { AppDb, DbExecutor } from "./client";
import { recordDiverActivity } from "./operations";
import { listTripReadiness } from "./readiness";
import { bookings, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { getWaiverForToken, threadWaiverKey } from "./waivers-completion";
import { type DoctorReferral, getDoctorReferral } from "./waivers-medical";
import { openWaiverInThread } from "./waivers-requests";

export type PartyWaiverState =
  | "needed"
  | "signed"
  | "medical_review"
  | "medical_not_cleared"
  | "held"
  | "not_required"
  | "unknown";
export type PartyWaiverMember = {
  bookingId: string;
  name: string | null;
  state: PartyWaiverState;
  guardianRequired: boolean;
  medicalState: "review" | "not_cleared" | null;
};

const WAIVER_GAPS = new Set([
  "waiver_not_sent",
  "waiver_lapsed",
  "waiver_runs_out",
  "waiver_pending",
  "guardian_signature_missing",
]);

/** Staff-only callers get operational status, never waiver answers or bearer links. */
export async function getPartyWaiverQueue(
  db: DbExecutor,
  input: { shopId: string; tripId: string; leadBookingId: string; now?: Date },
): Promise<{ tripTitle: string; members: PartyWaiverMember[] } | null> {
  const [lead] = await db
    .select({ id: bookings.id, title: trips.title, timezone: shops.timezone })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        eq(bookings.id, input.leadBookingId),
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        ne(trips.status, "cancelled"),
        isNull(bookings.partyLeadBookingId),
      ),
    )
    .limit(1);
  if (!lead) return null;
  const now = input.now ?? nowDate();
  const rows = await listTripReadiness(db, input.shopId, input.tripId, now);
  const members = rows
    .filter((row) => row.booking.id === lead.id || row.booking.partyLeadBookingId === lead.id)
    .sort((a, b) => {
      if (a.booking.id === lead.id) return -1;
      if (b.booking.id === lead.id) return 1;
      return (
        a.booking.createdAt.getTime() - b.booking.createdAt.getTime() ||
        a.booking.id.localeCompare(b.booking.id)
      );
    })
    .map((row): PartyWaiverMember => {
      if (row.booking.identityUnconfirmedAt)
        return {
          bookingId: row.booking.id,
          name: row.booking.identityBookedAs ?? null,
          state: "held",
          guardianRequired: false,
          medicalState: null,
        };
      const guardianRequired = guardianSignatureRequired(
        row.person.dateOfBirth,
        signingDate(now, lead.timezone),
        row.booking.minorDeclaredAt !== null,
      );
      const medicalState = row.readiness.blockers.some((b) => b.code === "medical_not_cleared")
        ? "not_cleared"
        : row.readiness.blockers.some((b) => b.code === "medical_review")
          ? "review"
          : null;
      if (!row.requirement)
        return {
          bookingId: row.booking.id,
          name: row.person.fullName,
          state: "unknown",
          guardianRequired,
          medicalState,
        };
      if (!row.requirement.requiresWaiver)
        return {
          bookingId: row.booking.id,
          name: row.person.fullName,
          state: "not_required",
          guardianRequired,
          medicalState,
        };
      const guardianMissing =
        row.waiver &&
        guardianSignatureMissing(row.waiver, {
          dateOfBirth: row.person.dateOfBirth,
          minorDeclared: row.booking.minorDeclaredAt !== null,
          timezone: lead.timezone,
        });
      const needs =
        !row.waiver ||
        guardianMissing ||
        row.readiness.blockers.some((b) => WAIVER_GAPS.has(b.code));
      const state = needs
        ? "needed"
        : medicalState === "not_cleared"
          ? "medical_not_cleared"
          : medicalState === "review"
            ? "medical_review"
            : "signed";
      return {
        bookingId: row.booking.id,
        name: row.person.fullName,
        state,
        guardianRequired,
        medicalState,
      };
    });
  return { tripTitle: lead.title, members };
}

/**
 * **The counter tablet's link for one seat's release** (issue #2743, ADR
 * 20261105-waiver-folds-into-the-thread). Locks the live departure and both
 * party seats, opens the seat's release the way its thread does
 * (`openWaiverInThread`: a live record and its draft are kept), and mints a
 * `waiver_link` capability naming that release: to the end of the departure
 * day, on any phone (issue #4064), spent by the signature, leaving any earlier counter link working. Nothing here reads or
 * hands on the release's own waiver link or the seat's readiness link.
 *
 * The QR can sign as the diver from any phone that scans it, so the
 * staffer who showed it is written on the diver's trail in the same
 * transaction (security review S2); no trail line, no link.
 */
export async function issuePartyWaiver(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    leadBookingId: string;
    bookingId: string;
    /** The staffer showing the QR. */
    actorPersonId: string;
    /** The desk confirmed a parent or guardian is here to co-sign a minor's release. */
    guardianPresent?: boolean;
    now?: Date;
  },
): Promise<{ token: string; expiresAt: Date } | { guardianCheck: true } | null> {
  try {
    return await db.transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
      const [trip] = await tx
        .select({ startsAt: trips.startsAt, endsAt: trips.endsAt, timezone: shops.timezone })
        .from(trips)
        .innerJoin(shops, eq(shops.id, trips.shopId))
        .where(
          and(
            eq(trips.id, input.tripId),
            eq(trips.shopId, input.shopId),
            liveTrip(),
            eq(trips.status, "scheduled"),
          ),
        )
        .for("no key update")
        .limit(1);
      if (!trip || hasReturned(trip.endsAt, input.now ?? nowDate())) return null;
      const ids = [...new Set([input.leadBookingId, input.bookingId])].sort();
      const locked = await tx
        .select({ id: bookings.id, personId: bookings.personId })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.tripId, input.tripId),
            inArray(bookings.id, ids),
          ),
        )
        .orderBy(asc(bookings.id))
        .for("update");
      const seat = locked.find((row) => row.id === input.bookingId);
      if (!seat || !locked.some((row) => row.id === input.leadBookingId)) return null;
      const queue = await getPartyWaiverQueue(tx, input);
      const member = queue?.members.find((entry) => entry.bookingId === input.bookingId);
      if (member?.state !== "needed") return null;
      // A minor signs at the counter only once the desk says a parent or
      // guardian is here to co-sign (issue #3986): the form asks for a
      // guardian's name, and nobody else at the counter can say whether the
      // person typing it is one. Asked before anything is opened or minted.
      if (member.guardianRequired && input.guardianPresent !== true) {
        return { guardianCheck: true as const };
      }
      const opened = await openWaiverInThread(tx, {
        shopId: input.shopId,
        bookingId: input.bookingId,
        expectedPersonId: seat.personId,
        expectedTripId: input.tripId,
        now: input.now,
      });
      if (!opened.ok) return null;
      // A fresh code leaves any code already open on a phone working. It
      // lasts to the end of the departure day (#4064); shown on a later day
      // of a multi-day trip, to the end of that day.
      const now = input.now ?? nowDate();
      const day = trip.startsAt > now ? trip.startsAt : now;
      const link = await mintCapability(tx, {
        purpose: "waiver_link",
        shopId: input.shopId,
        subjectId: opened.recordId,
        now: input.now,
        expiresAt: endOfLocalDay(day, trip.timezone),
      });
      // The waiver's own lock may also have waited past return. Roll the whole
      // issuance back instead of exposing or leaving a freshly minted link.
      if (hasReturned(trip.endsAt, input.now ?? nowDate())) throw new PartyWaiverTripReturned();
      if (!link.expiresAt) throw new Error("waiver_link minted without an expiry");
      const recorded = await recordDiverActivity(tx, {
        shopId: input.shopId,
        personId: seat.personId,
        actorPersonId: input.actorPersonId,
        code: "waiver_counter_code_shown",
        waiverRecordId: opened.recordId,
      });
      if (!recorded) throw new PartyWaiverNotRecorded();
      if (member.guardianRequired) {
        const confirmed = await recordDiverActivity(tx, {
          shopId: input.shopId,
          personId: seat.personId,
          actorPersonId: input.actorPersonId,
          code: "waiver_counter_guardian_confirmed",
          waiverRecordId: opened.recordId,
          // Signing asks about this code exactly (issue #4003).
          linkId: link.id,
        });
        if (!confirmed) throw new PartyWaiverNotRecorded();
      }
      return { token: link.token, expiresAt: link.expiresAt };
    });
  } catch (error) {
    if (error instanceof PartyWaiverTripReturned || error instanceof PartyWaiverNotRecorded)
      return null;
    throw error;
  }
}

/**
 * **The physician form the desk prints for a seat on its counter queue**
 * (issue #3984): a diver referred at the counter signed on the shop's tablet,
 * so nothing they hold opens a doctor's page. The seat must be on this
 * queue, its release waiting on a physician; the referral is the doctor's
 * page's own read (`getDoctorReferral`). The answers never reach the paper:
 * a staff print says to go through the whole questionnaire instead.
 */
export async function getCounterDoctorReferral(
  db: DbExecutor,
  input: { shopId: string; tripId: string; leadBookingId: string; bookingId: string; now?: Date },
): Promise<DoctorReferral | null> {
  const queue = await getPartyWaiverQueue(db, input);
  const member = queue?.members.find((entry) => entry.bookingId === input.bookingId);
  if (member?.state !== "medical_review") return null;
  const key = await threadWaiverKey(db, { shopId: input.shopId, bookingId: input.bookingId });
  if (!key) return null;
  const state = await getWaiverForToken(db, key, input.now);
  if (state.state !== "completed") return null;
  const referral = await getDoctorReferral(db, state.record, input.now);
  if (!referral) return null;
  return { ...referral, answers: referral.answers === "locked" ? "whole" : referral.answers };
}

class PartyWaiverTripReturned extends Error {}
class PartyWaiverNotRecorded extends Error {}
