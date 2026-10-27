import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { guardianSignatureMissing, guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { hasReturned } from "@/lib/trips";
import type { AppDb, DbExecutor } from "./client";
import { listTripReadiness } from "./readiness";
import { bookings, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { issueWaiverRequest } from "./waivers-requests";

export type PartyWaiverState =
  | "needed"
  | "signed"
  | "medical_review"
  | "held"
  | "not_required"
  | "unknown";
export type PartyWaiverMember = {
  bookingId: string;
  name: string | null;
  state: PartyWaiverState;
  guardianRequired: boolean;
  medicalReview: boolean;
};

const WAIVER_GAPS = new Set([
  "waiver_not_sent",
  "waiver_lapsed",
  "waiver_runs_out",
  "waiver_pending",
  "waiver_expired",
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
          medicalReview: false,
        };
      const guardianRequired = guardianSignatureRequired(
        row.person.dateOfBirth,
        signingDate(now, lead.timezone),
        row.booking.minorDeclaredAt !== null,
      );
      const medicalReview = row.readiness.blockers.some(
        (b) => b.code === "medical_review" || b.code === "medical_not_cleared",
      );
      if (!row.requirement)
        return {
          bookingId: row.booking.id,
          name: row.person.fullName,
          state: "unknown",
          guardianRequired,
          medicalReview,
        };
      if (!row.requirement.requiresWaiver)
        return {
          bookingId: row.booking.id,
          name: row.person.fullName,
          state: "not_required",
          guardianRequired,
          medicalReview,
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
      const state = needs ? "needed" : medicalReview ? "medical_review" : "signed";
      return {
        bookingId: row.booking.id,
        name: row.person.fullName,
        state,
        guardianRequired,
        medicalReview,
      };
    });
  return { tripTitle: lead.title, members };
}

/** Lock the live departure and both party seats before issuing only this person's waiver. */
export async function issuePartyWaiver(
  db: AppDb,
  input: { shopId: string; tripId: string; leadBookingId: string; bookingId: string; now?: Date },
): Promise<{ token: string; expiresAt: Date } | null> {
  try {
    return await db.transaction(async (tx) => {
      const [trip] = await tx
        .select({ endsAt: trips.endsAt })
        .from(trips)
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
        .select({ id: bookings.id })
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
      if (locked.length !== ids.length) return null;
      if (hasReturned(trip.endsAt, input.now ?? nowDate())) return null;
      const queue = await getPartyWaiverQueue(tx, input);
      if (queue?.members.find((member) => member.bookingId === input.bookingId)?.state !== "needed")
        return null;
      const issued = await issueWaiverRequest(tx, {
        shopId: input.shopId,
        bookingId: input.bookingId,
        now: input.now,
      });
      // The waiver's own lock may also have waited past return. Roll the whole
      // issuance back instead of exposing or leaving a freshly minted token.
      if (hasReturned(trip.endsAt, input.now ?? nowDate())) throw new PartyWaiverTripReturned();
      return issued.ok ? { token: issued.token, expiresAt: issued.expiresAt } : null;
    });
  } catch (error) {
    if (error instanceof PartyWaiverTripReturned) return null;
    throw error;
  }
}

class PartyWaiverTripReturned extends Error {}
