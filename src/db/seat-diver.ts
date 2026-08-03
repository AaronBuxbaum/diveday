import { trackEvent } from "@/lib/analytics";
import { type BookingOutcome, createBooking } from "./bookings";
import type { AppDb } from "./client";
import { recordTripActivity } from "./operations";
import { type IssueAndDeliverWaiverResult, issueWaiverOnJoin } from "./waiver-issue";

/**
 * Seating a diver has never been just the booking row. Every staff door that
 * puts someone on a boat owes the same four consequences: the transaction
 * (`createBooking`), the waiver the trip may require, the trip's activity
 * trail, and the analytics event. Five doors used to write those four things
 * out by hand — the trip roster's hand entry, its returning-diver picker, the
 * counter walk-in's two halves, and the diver record's "book on an upcoming
 * trip" — and they had drifted: the picker skipped the activity log, and the
 * diver record skipped *both* the activity log and the waiver, so a diver
 * booked from their own record silently never got a waiver email and showed up
 * at the dock unsigned.
 *
 * `seatDiver` is the one consequence path. A door decides *who* and *which
 * trip*; the differences that are real (the counter collects no email, and
 * deliberately shows one blunt refusal instead of four course-specific ones)
 * are explicit parameters, not a second implementation.
 */

type BookingRefusal = Exclude<BookingOutcome, { ok: true }>["reason"];

/**
 * Why a seating did not happen. Codes, never sentences — each surface maps
 * these to its own words (docs ADR 20260731-domain-layer-copy-leaks).
 *
 * `unavailable` is the collapsed refusal a `coarse` caller gets in place of
 * the course-specific gates. It exists as its own code rather than reusing
 * `trip_unavailable` so a caller's notice map can still say something true:
 * the boat may be perfectly available and the *diver* is what does not fit.
 */
export type SeatDiverRefusal = BookingRefusal | "unavailable";

/**
 * How the trip's activity trail describes the seating. Same event either way;
 * the crew reading the feed at the dock cares which door it came through.
 */
export type SeatDiverEntry = "roster" | "walk_in";

/**
 * How much of a refusal a surface repeats back.
 *
 * `specific` keeps every gate distinct — the trip page is where somebody
 * investigates *why* a diver bounced. `coarse` collapses the course gates
 * (prerequisite, ratio, unstaffed, minimum age) into one honest "not
 * available" so the counter is not asked to distinguish four rare cases with
 * a queue waiting; the trip page still holds the specific reason. That
 * collapse is a deliberate product choice, so it is a parameter here rather
 * than a per-door reimplementation of the same switch.
 */
export type SeatDiverRefusalDetail = "specific" | "coarse";

/** Who is being seated: a diver already on file, or a name typed at the desk. */
export type SeatDiverPerson =
  | { personId: string }
  | { fullName: string; email?: string; phone?: string };

export type SeatDiverInput = {
  shopId: string;
  tripId: string;
  /** The staff member doing it — attributed on the activity trail. */
  actorPersonId: string;
  diver: SeatDiverPerson;
  entry: SeatDiverEntry;
  refusals: SeatDiverRefusalDetail;
};

/**
 * What became of the waiver-on-join attempt — reported at the granularity a
 * staffer acts on, because the door's success notice is the only place the
 * difference ever surfaces.
 *
 * - `not_needed` — no waiver was owed: the trip gates none, or the diver is
 *   already covered by a current signature (sign-once). `issueWaiverOnJoin`
 *   decides; this only reports.
 * - `sent` — a link was issued *and* the email actually left the building.
 * - `not_delivered` — a link exists but nothing was mailed: no address on file
 *   (the normal walk-in), no provider configured, a rejected test recipient, a
 *   provider error. Staff must hand the link over themselves.
 * - `failed` — the link could not be issued at all.
 *
 * The distinction is the whole point of this type. It used to be a boolean
 * cast of `issueWaiverOnJoin`'s result, which made every one of those outcomes
 * read as "issued" — so the no-email counter walk-in, the *normal* case, told
 * the staffer a waiver was on its way while the diver's readiness sat waiting
 * for a signature that nobody had been asked for.
 *
 * Never fatal: a diver keeps their seat no matter which of these it is.
 */
export type SeatDiverWaiver = "not_needed" | "sent" | "not_delivered" | "failed";

export type SeatDiverResult =
  | {
      ok: true;
      bookingId: string;
      personId: string;
      personName: string;
      waiver: SeatDiverWaiver;
    }
  | { ok: false; reason: SeatDiverRefusal };

/**
 * The activity-feed phrasing. Stored trail text, composed the same place the
 * feed's own `${actorName} ${action}` sentence is (src/db/operations.ts) —
 * the activity trail is a record of what happened, not localized UI copy.
 */
function activityAction(entry: SeatDiverEntry, personName: string): string {
  return entry === "walk_in"
    ? `added ${personName} to the trip as a walk-in`
    : `added ${personName} to the trip`;
}

function collapse(reason: BookingRefusal, detail: SeatDiverRefusalDetail): SeatDiverRefusal {
  if (detail === "specific") return reason;
  return reason === "trip_full" || reason === "already_booked" ? reason : "unavailable";
}

/**
 * Read `issueWaiverOnJoin`'s real result rather than its truthiness.
 *
 * `null` is "nothing was owed". Everything else is an
 * `IssueAndDeliverWaiverResult`, and only `delivery: "sent"` means a diver
 * actually received something — `no_email`, `unconfigured`, `test_recipient`,
 * and `failed` all mean a link exists that only staff can hand over
 * (`WaiverDelivery`, src/db/waiver-issue.ts). `already_completed` reaches here
 * as a refusal but is not a problem: the diver's signature is already on file,
 * which is the same nothing-to-do as `null`.
 */
function waiverOutcome(result: IssueAndDeliverWaiverResult | null): SeatDiverWaiver {
  if (!result) return "not_needed";
  if (!result.ok) return result.reason === "already_completed" ? "not_needed" : "failed";
  return result.delivery === "sent" ? "sent" : "not_delivered";
}

/**
 * Put one diver on one trip, with every consequence a staff seating owes.
 *
 * The booking itself stays exactly one transaction (`createBooking`); the
 * consequences that follow are best-effort by design and run after it commits,
 * in the order a person would want them: the seat is real, then the waiver
 * goes out, then the trail records who did it. A waiver delivery failure is
 * caught and reported, never thrown — a diver keeps their seat even when the
 * mail provider is down.
 */
export async function seatDiver(db: AppDb, input: SeatDiverInput): Promise<SeatDiverResult> {
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: input.shopId,
    tripId: input.tripId,
    ...input.diver,
  });
  if (!outcome.ok) {
    await trackEvent({ name: "booking_blocked", source: "staff", reason: outcome.reason });
    return { ok: false, reason: collapse(outcome.reason, input.refusals) };
  }
  await trackEvent({ name: "booking_completed", source: "staff", partySize: 1 });

  let waiver: SeatDiverWaiver;
  try {
    // Uses the resolved booking, so a returning diver picked by identity gets
    // the same waiver-on-join a hand-entered walk-in does. Idempotent: a
    // diver already holding a link or a signature is skipped, not re-sent.
    waiver = waiverOutcome(await issueWaiverOnJoin(db, input.shopId, outcome.bookingId));
  } catch {
    console.error("Waiver-on-join could not be issued", { bookingId: outcome.bookingId });
    waiver = "failed";
  }

  // `outcome.personName` rather than whatever was typed: the identity path
  // submits no name at all, and the hand-entry path may have matched an
  // existing person by email whose name on file is the one the crew knows.
  await recordTripActivity(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    actorPersonId: input.actorPersonId,
    action: activityAction(input.entry, outcome.personName),
  });

  return {
    ok: true,
    bookingId: outcome.bookingId,
    personId: outcome.personId,
    personName: outcome.personName,
    waiver,
  };
}
