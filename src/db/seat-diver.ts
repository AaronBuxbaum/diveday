import { and, eq, isNull } from "drizzle-orm";
import { trackEvent } from "@/lib/analytics";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { ParticipantType } from "@/lib/participant-types";
import type { TripAdmissionRefusal } from "@/lib/trip-admission";
import { hasSailed } from "@/lib/trips";
import {
  type BookingOutcome,
  createBooking,
  createBookingParty,
  type FreshPersonDetails,
  type MoveBookingOutcome,
  moveBooking,
} from "./bookings";
import type { AppDb } from "./client";
import { recordDeskEvent } from "./desk-events";
import { type FlySafeCorrectionOutcome, sendFlySafeCorrections } from "./fly-safe-correction";
import { publishManifestEvent } from "./manifest-events";
import { sendCourseSeatConfirmation, sendStaffSeatingConfirmation } from "./notifications";
import { recordSeatChange, type SeatChangeCode } from "./operations";
import { people, shops, trips } from "./schema";
import { type SendRescheduleNoticesOptions, sendSeatMoveNotice } from "./trip-rescheduled";
import { liveTrip } from "./trips-live";
import {
  type IssueAndDeliverWaiverResult,
  issueJoinWaiverLink,
  issueWaiverOnJoin,
  settleJoinWaiverDelivery,
} from "./waiver-issue";

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

type BookingRefusalReason = Exclude<BookingOutcome, { ok: true }>["reason"];

/**
 * Why a seating did not happen. Codes, never sentences — each surface maps
 * these to its own words (docs ADR 20260731-domain-layer-copy-leaks).
 *
 * `unavailable` is the collapsed refusal a `coarse` caller gets in place of
 * the course-specific gates. It exists as its own code rather than reusing
 * `trip_unavailable` so a caller's notice map can still say something true:
 * the boat may be perfectly available and the *diver* is what does not fit.
 */
export type SeatDiverRefusal = BookingRefusalReason | "unavailable";

/**
 * How the trip's activity trail describes the seating. Same event either way;
 * the crew reading the feed at the dock cares which door it came through.
 */
export type SeatDiverEntry = "roster" | "walk_in" | "dock";

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
  /**
   * `fromNameMatch` mirrors `BookingPerson`'s field of the same name and is
   * spread straight into `createBooking` below: it carries the name the
   * staffer typed into the counter's "is this the same diver?" prompt, and
   * that booking decides from the name whether the seat is
   * identity-unconfirmed (issue #1556). A door seating a diver picked from
   * a search list passes no `fromNameMatch`, and its seat lands released by
   * decision (H-79, issue #1790; `BookingPerson.fromNameMatch`).
   */
  | { personId: string; fromNameMatch?: { typedName: string } }
  | { fullName: string; email?: string; phone?: string; freshPerson?: FreshPersonDetails };

export type SeatDiverInput = {
  shopId: string;
  tripId: string;
  /** The staff member doing it — attributed on the activity trail. */
  actorPersonId: string;
  diver: SeatDiverPerson;
  entry: SeatDiverEntry;
  refusals: SeatDiverRefusalDetail;
  /**
   * What the seat is for (ADR 20261007-participant-types). Absent is a
   * diver's, as every door seated before the type existed. Staff may seat a
   * snorkeler or a rider whether or not the public form sells that seat; the
   * booking transaction still holds the boat, the divers-only limit and the
   * no-non-divers-on-a-course rule.
   */
  participantType?: ParticipantType;
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

/**
 * Whether the diver was sent the booking confirmation (fourth UX review,
 * item 3), so the door can say "Their confirmation is on its way."
 *
 * - `sent` — the departure has not sailed (at the walk-in counter, it is on a
 *   later day than today at the shop), and the confirmation (with the waiver
 *   riding in it when one was owed) went out.
 * - `not_sent` — it was owed and could not go: no address, no provider, a
 *   provider error. The door's ordinary notice stands.
 * - `not_needed` — the counter's seat on today's boat (the diver is standing
 *   there), a departure that has sailed, or a held seat, which is owed nothing
 *   until its identity is confirmed (#2125).
 */
export type SeatDiverConfirmation = "sent" | "not_sent" | "not_needed";

export type SeatDiverResult =
  | {
      ok: true;
      bookingId: string;
      personId: string;
      personName: string;
      waiver: SeatDiverWaiver;
      confirmation: SeatDiverConfirmation;
      /**
       * The release link to hand over when `waiver` is `not_delivered` — the
       * bearer path the crew can open on their own phone for the person in
       * front of them to sign. Absent whenever nothing is owed or it went by
       * email.
       */
      waiverPath?: string;
      /**
       * The seat is held: `createBooking` attached it to an existing person on
       * something short of proof and stamped `identityUnconfirmedAt`, so the
       * boarding gate refuses it until a staffer confirms the identity
       * (H-13, issue #1556).
       *
       * Carried out to the door for the same reason `waiver` is: this is the
       * one fact a plain "Added" hides, and the staffer otherwise meets it as
       * a check-in refusal later, with the diver at the counter.
       */
      identityUnconfirmed: boolean;
    }
  | {
      ok: false;
      reason: SeatDiverRefusal;
      /**
       * The `trip_prerequisite` refusal's structured detail — which requirement
       * failed and what the diver holds — carried through rather than dropped.
       *
       * It used to stop here: `createBooking` returned it, `seatDiver` kept only
       * the code, and every staff surface rendered one static sentence that
       * could not tell "their Deep card isn't on file" (add the card) from
       * "they are not an Advanced diver" (no card to add — that's a course).
       * The second reading is the dangerous one: it points a staffer at the
       * certifications form as the way past a safety gate, and a hand-entered
       * card clears admission on the very next attempt (H-24).
       *
       * Absent for every other refusal, and absent whenever a `coarse` surface
       * collapsed this one — the counter's deliberately blunt vocabulary must
       * not grow a specific reason through the back door.
       */
      refusal?: TripAdmissionRefusal;
    };

/**
 * Which line the trail gets: the same act, told two ways.
 *
 * A walk-in and a booked seat are the same insert with different stories behind
 * them, and the trail is where a shop reads the difference back. The words are
 * picked where the trail is rendered (issue #1655) — this only says which
 * sentence; `recordSeatChange` reads the name off the seat.
 */
function activityCode(entry: SeatDiverEntry): SeatChangeCode {
  switch (entry) {
    case "walk_in":
      return "seat_added_walk_in";
    // A rider the crew added at the boat (`src/db/dock-rider.ts`).
    case "dock":
      return "rider_added_at_dock";
    case "roster":
      return "seat_added";
  }
}

function collapse(reason: BookingRefusalReason, detail: SeatDiverRefusalDetail): SeatDiverRefusal {
  if (detail === "specific") return reason;
  return reason === "trip_full" || reason === "divers_full" || reason === "already_booked"
    ? reason
    : "unavailable";
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
    participantType: input.participantType ?? "diver",
    ...input.diver,
  });
  if (!outcome.ok) {
    await trackEvent({ name: "booking_blocked", source: "staff", reason: outcome.reason });
    const reason = collapse(outcome.reason, input.refusals);
    // Only when the collapse left the specific code standing: a `coarse`
    // surface asked for one blunt answer, and detail attached to
    // `unavailable` would contradict the sentence it renders.
    return outcome.reason === "trip_prerequisite" && reason === "trip_prerequisite"
      ? { ok: false, reason, refusal: outcome.refusal }
      : { ok: false, reason };
  }
  await trackEvent({ name: "booking_completed", source: "staff", partySize: 1 });

  return seatConsequences(db, input, outcome);
}

/** What every party member carries, whoever they are. */
type SeatPartyMemberFacts = {
  /** The row's "Under 18" tick: a parent or guardian co-signs this seat's release. */
  minor: boolean;
  /** The row's "Coming as" (ADR 20261007-participant-types); absent is a diver. */
  participantType?: ParticipantType;
  /**
   * A date of birth the counter asked for beside "Under 18", `YYYY-MM-DD`,
   * already checked by the caller. Written onto the person only where their
   * record has none: the counter never overwrites a date on file.
   */
  dateOfBirth?: string;
};

/**
 * One person on the walk-in form's party rows (fifth loop, item 9): a name
 * typed for somebody new, or the record the staffer picked for that row from
 * the on-file prompt, with the name they had typed for it (`typedName`, which
 * the booking compares the way the single walk-in's prompt does, issue #1556).
 */
export type SeatPartyMember = SeatPartyMemberFacts &
  ({ fullName: string; email?: string; phone?: string } | { personId: string; typedName: string });

export type SeatPartyResult =
  | { ok: true; seats: Extract<SeatDiverResult, { ok: true }>[] }
  | (Extract<SeatDiverResult, { ok: false }> & {
      /** Which member the party was refused on, so the form can point at that row. */
      failedIndex: number;
    });

/**
 * **A walk-in family on the boat in one pass** (fifth loop, item 9). Every
 * member is booked in one all-or-nothing transaction (`createBookingParty`):
 * the counter never leaves two of four seated and the other two refused, and
 * capacity is checked for the whole party at once. Each seat past the first
 * leads back to the first, which is how a party is a party everywhere else.
 *
 * An "Under 18" tick is the seat's `minor_declared_at`, the same fact the
 * public party form writes, so the release asks a parent or guardian to sign
 * with them and boarding waits for both (`guardianSignatureRequired`). It
 * gates nothing at the counter. After the commit each seat is owed exactly
 * what one walk-in is (`seatConsequences`), and the manifest refreshes once.
 */
export async function seatParty(
  db: AppDb,
  input: Omit<SeatDiverInput, "diver"> & { members: readonly SeatPartyMember[] },
): Promise<SeatPartyResult> {
  const outcome = await createBookingParty(
    db,
    input.members.map((member) => ({
      actor: "staff" as const,
      shopId: input.shopId,
      tripId: input.tripId,
      participantType: member.participantType ?? input.participantType ?? "diver",
      ...("personId" in member
        ? { personId: member.personId, fromNameMatch: { typedName: member.typedName } }
        : { fullName: member.fullName, email: member.email, phone: member.phone }),
      minorDeclared: member.minor || undefined,
    })),
  );
  if (!outcome.ok) {
    await trackEvent({ name: "booking_blocked", source: "staff", reason: outcome.reason });
    const reason = collapse(outcome.reason, input.refusals);
    return outcome.reason === "trip_prerequisite" && reason === "trip_prerequisite"
      ? { ok: false, reason, refusal: outcome.refusal, failedIndex: outcome.failedIndex }
      : { ok: false, reason, failedIndex: outcome.failedIndex };
  }
  await trackEvent({
    name: "booking_completed",
    source: "staff",
    partySize: outcome.bookings.length,
  });
  // Before the release goes out, so the waiver reads the age the counter asked.
  for (const [index, booking] of outcome.bookings.entries()) {
    const dateOfBirth = input.members[index]?.dateOfBirth;
    // A record the name match left in doubt may be someone else; nothing typed lands on it.
    if (!dateOfBirth || booking.identityUnconfirmed) continue;
    await db
      .update(people)
      .set({ dateOfBirth })
      .where(
        and(
          eq(people.id, booking.personId),
          eq(people.shopId, input.shopId),
          isNull(people.dateOfBirth),
        ),
      );
  }
  const seats: Extract<SeatDiverResult, { ok: true }>[] = [];
  for (const booking of outcome.bookings) {
    seats.push(await seatConsequences(db, input, booking, { publish: false }));
  }
  await publishManifestEvent(db, input.shopId, input.tripId);
  return { ok: true, seats };
}

/** What a booking that just committed hands its consequences: who sits where. */
type SeatedBooking = {
  bookingId: string;
  personId: string;
  personName: string;
  identityUnconfirmed: boolean;
};

/**
 * **Every consequence a staff seating owes, after the seat commits**: the
 * confirmation or the waiver, the course materials, the trail, the desk event
 * and the manifest refresh. One path for one diver (`seatDiver`) and for each
 * member of a party (`seatParty`), so a family seated together is owed exactly
 * what four walk-ins were.
 */
async function seatConsequences(
  db: AppDb,
  input: Omit<SeatDiverInput, "diver" | "refusals">,
  outcome: SeatedBooking,
  options: { publish?: boolean } = {},
): Promise<Extract<SeatDiverResult, { ok: true }>> {
  let waiver: SeatDiverWaiver = "not_needed";
  let waiverPath: string | undefined;
  let confirmation: SeatDiverConfirmation = "not_needed";
  const takeWaiver = (issued: IssueAndDeliverWaiverResult | null) => {
    waiver = waiverOutcome(issued);
    if (issued?.ok && issued.delivery !== "sent") {
      waiverPath = issued.path ?? `/waivers/${issued.token}`;
    }
  };

  // **A staff seating gets the confirmation an online booking gets** (fourth
  // UX review, item 3): a phone booking (the 1:30 booked at 9 AM included), a
  // seat from a date request, a regular put on next Saturday. The waiver
  // rides in it as its first step, the way `bookSpot`'s does, so one seating
  // is still one email; when the confirmation cannot go, the waiver goes on
  // its own the old way. Only the walk-in counter knows the diver is standing
  // at the desk, so only its seat on today's boat keeps the counter's path;
  // a held seat is owed nothing until its identity is confirmed (#2125).
  const confirms =
    !outcome.identityUnconfirmed &&
    (await departureOwesConfirmation(db, input.shopId, input.tripId, input.entry));
  if (confirms) {
    try {
      const link = await issueJoinWaiverLink(db, input.shopId, outcome.bookingId);
      const delivery = await sendStaffSeatingConfirmation(db, input.shopId, outcome.bookingId, {
        waiver: link,
      });
      confirmation = delivery?.status === "sent" ? "sent" : "not_sent";
      if (link) {
        const fallback = await settleJoinWaiverDelivery(db, {
          shopId: input.shopId,
          bookingId: outcome.bookingId,
          link,
          confirmationSent: confirmation === "sent",
        });
        if (confirmation === "sent") waiver = "sent";
        else takeWaiver(fallback);
      } else {
        // No link minted: nothing was owed, or issuing failed. The join-send
        // tells the two apart and reports which.
        takeWaiver(await issueWaiverOnJoin(db, input.shopId, outcome.bookingId));
      }
    } catch (error) {
      log("booking.staff_confirmation_failed", "error", {
        bookingId: outcome.bookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      if (confirmation === "not_needed") confirmation = "not_sent";
      if (waiver === "not_needed") waiver = "failed";
    }
  } else {
    try {
      // Uses the resolved booking, so a returning diver picked by identity gets
      // the same waiver-on-join a hand-entered walk-in does. Idempotent: a
      // diver already holding a link or a signature is skipped, not re-sent.
      takeWaiver(await issueWaiverOnJoin(db, input.shopId, outcome.bookingId));
    } catch (error) {
      log("booking.waiver_on_join_failed", "error", {
        bookingId: outcome.bookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      waiver = "failed";
    }

    // A course student seated for today still hears what to work through, the
    // same confirmation a self-booked student gets, sent only when the course
    // carries learning materials (ADR 20261008-course-learning-materials).
    // Best-effort like the waiver: the seat stands whatever the mail does.
    try {
      await sendCourseSeatConfirmation(db, input.shopId, outcome.bookingId);
    } catch (error) {
      log("booking.course_confirmation_failed", "error", {
        bookingId: outcome.bookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }

  // Named off the seat rather than whatever was typed: the identity path
  // submits no name at all, and a held seat reads as it was booked (issue
  // #2128). After the seat commits, not inside it: `createBooking` is every
  // door's insert, and this is the one consequence path for staff seating.
  await recordSeatChange(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    actorPersonId: input.actorPersonId,
    bookingId: outcome.bookingId,
    code: activityCode(input.entry),
  });

  // "Lina Costa took a seat." on the manifest's catch-up strip (issue #1202).
  // Written here rather than at any of the four seating surfaces, for the same
  // reason the waiver and the trail are: this is the one consequence path for
  // seating, and a call site that forgot it would leave a captain reading a
  // roster with a name on it nobody told them about.
  await recordDeskEvent(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    kind: "seat_taken",
    bookingId: outcome.bookingId,
    subjectPersonId: outcome.personId,
    actorPersonId: input.actorPersonId,
  });

  // A diver just appeared on the roster. This is the archetypal change that
  // lands *while a captain is walking to the boat* — a walk-in seated at the
  // counter — so it is exactly what the manifest's refresh triggers exist for
  // (ADR 20260804-manifest-web-push). Best-effort and never thrown, like every
  // other call to it, and deliberately after the booking and its side effects
  // rather than inside them.
  if (options.publish !== false) await publishManifestEvent(db, input.shopId, input.tripId);

  return {
    ok: true,
    bookingId: outcome.bookingId,
    personId: outcome.personId,
    personName: outcome.personName,
    waiver,
    waiverPath,
    confirmation,
    identityUnconfirmed: outcome.identityUnconfirmed,
  };
}

/**
 * Whether a staff seating on this departure is a booking to confirm: any
 * departure that has not sailed, except the walk-in counter's seat on today's
 * boat (both days read in the shop's own time zone), where the diver is
 * standing at the desk. The door says which it is; the calendar never guesses.
 */
async function departureOwesConfirmation(
  db: AppDb,
  shopId: string,
  tripId: string,
  entry: SeatDiverEntry,
  now: Date = nowDate(),
): Promise<boolean> {
  const [row] = await db
    .select({ startsAt: trips.startsAt, timezone: shops.timezone })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!row || hasSailed(row.startsAt, now)) return false;
  if (entry === "roster") return true;
  return (
    calendarDateInTimezone(row.startsAt, row.timezone) > calendarDateInTimezone(now, row.timezone)
  );
}

export type { MoveBookingRefusal as MoveSeatRefusal } from "./bookings";

export type MoveSeatResult =
  | Exclude<MoveBookingOutcome, { ok: true }>
  | (Extract<MoveBookingOutcome, { ok: true }> & {
      waiver: SeatDiverWaiver;
      /** Whether the diver heard the new time: `skipped` when it did not change. */
      notice: "told" | "failed" | "skipped";
      /** A correction may be owed independently of the time-change notice. */
      flySafe: FlySafeCorrectionOutcome | "failed";
    });

/**
 * **Move a booked seat to another departure, with every consequence a seating
 * owes** (ADR 20261013-staff-move-a-seat). The move itself is one transaction
 * (`moveBooking`); after it commits, in the order a person would want: the new
 * departure's waiver if it asks for one the seat does not hold, the diver told
 * the new time, and both manifests refreshed. Both trails' lines are written
 * inside the move itself. Each consequence is
 * best-effort: the seat has moved whatever the mail does.
 */
export async function moveSeat(
  db: AppDb,
  input: {
    shopId: string;
    fromTripId: string;
    toTripId: string;
    bookingId: string;
    actorPersonId: string;
  },
  notices: SendRescheduleNoticesOptions = {},
): Promise<MoveSeatResult> {
  const moved = await moveBooking(db, input);
  if (!moved.ok) return moved;
  const movedAt = notices.now ?? nowDate();

  let waiver: SeatDiverWaiver;
  try {
    waiver = waiverOutcome(await issueWaiverOnJoin(db, input.shopId, input.bookingId));
  } catch (error) {
    log("booking.waiver_on_join_failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    waiver = "failed";
  }

  let notice: "told" | "failed" | "skipped";
  try {
    notice = await sendSeatMoveNotice(
      db,
      {
        shopId: input.shopId,
        bookingId: input.bookingId,
        fromTripId: moved.fromTripId,
        movedAt,
      },
      notices,
    );
  } catch (error) {
    log("booking.seat_move_notice_failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    notice = "failed";
  }

  let flySafe: FlySafeCorrectionOutcome | "failed";
  try {
    flySafe = await sendFlySafeCorrections(db, {
      shopId: input.shopId,
      tripId: moved.toTripId,
      bookingId: input.bookingId,
      now: movedAt,
      emailProvider: notices.emailProvider,
    });
  } catch (error) {
    log("booking.fly_safe_correction_failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    flySafe = "failed";
  }

  await publishManifestEvent(db, input.shopId, moved.fromTripId);
  await publishManifestEvent(db, input.shopId, moved.toTripId);
  return { ...moved, waiver, notice, flySafe };
}
