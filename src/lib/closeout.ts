import { hasReturned, hasSailed } from "@/lib/trips";
import { nowDate } from "./clock";
import { type CrewRollCallSubject, crewIsAccountedFor, crewRollCallCounts } from "./manifests";
import { type OpenSeatsDebrief, openSeatsDebrief } from "./open-seats";
import type { PlanChangeReason } from "./plan-change";
import { rollCallCheckpoints } from "./roll-call";
import type { RollCallGapReason, TodayAction, TodayActionKind } from "./today";
import { sortActions } from "./today";
import { liveStageOf, type TripStageReading } from "./trip-stages";
import { shopDayBounds, toDateInputValue, utcToWallTime } from "./zoned";

/**
 * **The day's closing state — the evening half of the shop home's spine.**
 *
 * Today owns the morning ("can the boats sail, who needs me before they do?");
 * this module answers the closing questions: did every boat come home counted,
 * what work from today is still open and what does the shop choose to do about
 * it, and what is waiting tomorrow morning.
 *
 * It had a page of its own until 2026-08-28. It does not any more (H-62; ADR
 * 20260827-clearwater-surface-language, decision 4): the evening is a *state*
 * the home's spine settles into station by station, and `/close-out` is a 308
 * to the home. Everything below survived that fold unchanged, because none of
 * it was ever about a route — {@link assembleEveningClose} is the join that
 * turns these facts into stations.
 *
 * It is an *assembly*, never a second detector. Every fact here is composed
 * from the outputs the source-of-truth modules already produce — the roll-call
 * gaps `src/db/today.ts`'s `listRollCallGaps` chases, and the `TodayAction`
 * queue `getTodayWork` builds. Re-deriving either rule here is the failure
 * mode this docblock exists to forbid: an evening that counts a head count
 * differently than the queue that chases it would let the two disagree about
 * whether a person is accounted for.
 *
 * Closing the day is a **ritual, not a gate**. The recorded act (see
 * `buildCloseoutSnapshot`) remembers who closed the day and what was still
 * outstanding, and nothing anywhere may condition on it — not tomorrow's
 * queue, not bookings, nothing. Nothing stands in front of the act either: the
 * acknowledgement checkbox that used to is gone, because H-57 already has the
 * shop deciding each leftover as it meets it, and re-asking at the close is a
 * confirm on a reversible act.
 *
 * This is the framework-free half: `src/db/closeout.ts` gathers the facts and
 * owns the append-only trail. Words come from `src/i18n/closeout-labels.ts`;
 * this file returns codes.
 */

/**
 * How one of today's departures stands at the end of the day, in descending
 * loudness. The gap statuses deliberately mirror the glossary's "unaccounted
 * for" split (kinds 1–4 versus 5–6): the ones that can mean a person is in
 * the water are never toned or worded like paperwork.
 *
 * - `unreconciled` — the departure carries an after-dive gap (missing diver or
 *   crew, or an unfinished after-dive count). Loudest state on the page.
 * - `still_out` — the boat has left and is not due back yet. Not an alarm, but
 *   a day cannot quietly read "everyone is home" while it isn't.
 * - `count_open` — a dock-count gap (`departure_uncounted` / `no_roll_call`).
 *   Paperwork, toned as such — see DOM-H3's wallpaper lesson in
 *   `src/lib/today.ts`.
 * - `not_departed` — closing before a boat has even left. Stated, quietly.
 * - `all_home` — the head count closed clean. The state the ritual exists to
 *   confirm.
 */
export type CloseoutDepartureStatus =
  | "unreconciled"
  | "still_out"
  | "count_open"
  | "not_departed"
  | "all_home";

/** Page order: loudest first; `startsAt` breaks ties inside a band. */
export const CLOSEOUT_STATUS_RANK: Record<CloseoutDepartureStatus, number> = {
  unreconciled: 0,
  still_out: 1,
  count_open: 2,
  not_departed: 3,
  all_home: 4,
};

/**
 * Tone only — the words live in `src/i18n/closeout-labels.ts`, so colour never
 * carries the meaning alone (design/principles.md #6). `positive` exists here
 * and not in `ACTION_KIND_META` because "all home" is the earned state this
 * surface is *for*, not the absence of a row.
 */
export const CLOSEOUT_STATUS_TONES: Record<
  CloseoutDepartureStatus,
  "danger" | "warning" | "neutral" | "positive"
> = {
  unreconciled: "danger",
  still_out: "warning",
  count_open: "warning",
  not_departed: "neutral",
  all_home: "positive",
};

/**
 * The gap reasons that mean a person may still be in the water (glossary
 * kinds 1–4), as opposed to the dock-count reasons, which are paperwork. The
 * split decides which departures read as `unreconciled` — the loudest state a
 * station can settle into — and which read as `count_open`.
 *
 * It used to decide a second thing: which departures had to be *acknowledged
 * by name* before the day could close. That gate is gone (ADR
 * 20260827-clearwater-surface-language's rejected alternative, and H-57 before
 * it): leftovers are dismissed per row as they are decided, so a checkbox at
 * the close re-asked a question already answered — a confirm on a reversible
 * act, which principle 7 refuses.
 */
const AFTER_DIVE_GAP_REASONS: ReadonlySet<RollCallGapReason> = new Set([
  "missing_diver",
  "missing_crew",
  "after_dive_uncounted",
  "crew_uncounted",
]);

/**
 * Which gap headlines a trip that carries several (`listRollCallGaps` emits at
 * most one diver, one crew, and one dock row per trip). Presentation order
 * only — detection stays in `src/db/today.ts` — matching the glossary's
 * severity numbering so the close-out can never headline a clerical gap over
 * a missing person.
 */
const GAP_REASON_RANK: Record<RollCallGapReason, number> = {
  missing_diver: 0,
  missing_crew: 1,
  after_dive_uncounted: 2,
  crew_uncounted: 3,
  departure_uncounted: 4,
  no_roll_call: 5,
};

/**
 * **One dive whose actual site was not the planned one** (issue #1184, D24).
 *
 * Read off `executed_dives`, never inferred: the manifest's own dive log is
 * where a crew records both the site they dived and, optionally, why. A dive
 * that changed with nothing said about why still carries the true half.
 */
export type CloseoutPlanChange = {
  diveNumber: number;
  /** The site the boat actually dived, as the shop named it. */
  siteName: string;
  reasonCode: PlanChangeReason | null;
};

/**
 * **Did this seat sail?** Asked of every non-cancelled booking on a departure,
 * and the whole of what {@link CloseoutTripInput.sailed} counts (issue #1689).
 *
 * The evidence is ranked, strongest first, because the two statements this
 * product holds about a seat are made by different people at different moments
 * and can disagree:
 *
 * 1. **The crew's dock tap.** `boarded` at the `departure` checkpoint is
 *    somebody on the boat saying they counted this body aboard — "the
 *    strongest evidence this product holds about where a person is"
 *    (`reclaimReleasedSeat`, src/db/manifests.ts). `not_boarded` *there* means
 *    "never left the dock" and nothing else, which is why the caller must read
 *    it through a departure-pinned reader (`listDepartureRollCallByTrip`): the
 *    same word at an after-dive checkpoint means "did not come back", and that
 *    diver sailed.
 * 2. **The desk's mark.** `bookings.status = 'no_show'` is one staffer's
 *    statement that the diver never turned up. It answers only for a seat the
 *    crew said nothing about, which is why it is the fallback and not the rule.
 *
 * The ranking is the half of #1689 the first fix missed. It read the desk's
 * mark alone, and the commoner shape of the miscount is the other one: the
 * crew tap "Not boarded" for the two who never showed — which is what closes
 * the dock count at a busy dock — and nobody at the desk ever does the "Not
 * here?" tap inside its window. Booking status stayed `booked`, so the evening
 * counted those two out *and* home and said "10 divers and 2 crew out, 12
 * back" over a boat that carried eight.
 *
 * **A seat nobody spoke for counts.** No dock result and no mark is an
 * unfinished dock count, and `listRollCallGaps` is already raising
 * `departure_uncounted` or `no_roll_call` over it — so the station reads
 * `count_open` and {@link EveningClose.allHome} can never be granted on the
 * strength of this fallback.
 *
 * **Two cases it deliberately answers "not aboard" to, with the direction
 * stated so nobody reads them as oversights.** A diver the crew marked ashore
 * at the dock and then boarded at a later checkpoint — `inAfterDivePopulation`
 * in src/db/today.ts names them — is not counted, because "souls on board" is
 * how many the vessel *left with* (glossary) and nobody was left behind either
 * way: they carry no after-dive gap, so both halves of the sentence move
 * together. And a boarding recorded on an offline device that never syncs is
 * invisible here, so a seat the desk also marked lands in neither `out` nor
 * `back` where it used to land in both; `out === back` either way, and no
 * version of this count detects an event that never arrived.
 */
export function seatSailed(input: {
  /** `bookings.status === "no_show"` — the desk's own statement. */
  noShow: boolean;
  /** The standing result at the **departure** checkpoint; null when there is none. */
  dockResult: "boarded" | "not_boarded" | null;
}): boolean {
  if (input.dockResult === "boarded") return true;
  if (input.dockResult === "not_boarded") return false;
  return !input.noShow;
}

/** One of today's departures, as the db layer hands it in. */
export type CloseoutTripInput = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** Non-cancelled bookings — a fact about the trip, shown beside its state. */
  booked: number;
  /**
   * **Divers the departure actually carried** — the roster less every seat the
   * shop's own records place ashore, which is the crew's `not_boarded` at the
   * dock first and the desk's `no_show` mark second ({@link seatSailed}, issue
   * #1689).
   *
   * Its own field rather than a narrowing of `booked`, because the readers
   * either side of it want the roster: `openSeatsDebrief` subtracts seats from
   * capacity, and a released seat never came back to the shelf. The homecoming
   * sentence is the one reader asking who was *aboard*, and it counted a diver
   * left standing on the dock as having gone out and come home because both
   * questions shared one number.
   *
   * **Never defaulted to `booked`.** A default is how a later caller puts that
   * miscount back with a green suite, which is why this is required on the
   * input rather than optional.
   */
  sailed: number;
  /** Seats the departure had, for the evening's open-seats reading. */
  capacity: number;
  /** Decides the closing checkpoint the crew are counted at. */
  plannedDives: number;
  /**
   * The trip's **assigned** crew — `trip_assignments` — each carrying their
   * result at the closing checkpoint. Not "whoever already has a result": that
   * distinction is the whole of issue #1346, and `crewIsAccountedFor`'s
   * docblock has the reasoning. Absence of a result is *awaiting*, never
   * accounted for, so an empty list withholds the moment rather than granting
   * it.
   */
  crew: readonly CrewRollCallSubject[];
  /**
   * The crew's last tap on the manifest (`src/lib/trip-stages.ts`), or null.
   * Read through `liveStageOf`, never raw: a word the crew stopped maintaining
   * stops speaking, and a stale one must not move this reading either way.
   */
  stage?: TripStageReading | null;
  /** Newest non-cancelled booking on this departure. Null when nobody booked. */
  lastBookingAt?: Date | null;
  /** Whether a last-minute deal ever went out on this departure. */
  dealSent?: boolean;
  /** The most recent same-title departure that filled, if there is one. */
  comparable?: { title: string; startsAt: Date; samePrice: boolean } | null;
  /** Dives whose actual site was not the planned one. */
  planChanges?: readonly CloseoutPlanChange[];
  /**
   * The crew's post-trip note, as it stands. Carried here because the close-out
   * is where it gets written: the hourly recap scan mails each diver no earlier
   * than four hours after the departure ends, so the evening the boat came in is
   * both the last chance to add "the eagle ray on the second dive" and the one
   * moment someone still remembers it. Null when nothing is written yet.
   */
  recapShoutout: string | null;
  /** The latest successful recap send, if this departure is now locked. */
  recapSentAt?: Date | null;
  /** Whether automatic recap sending is paused for this departure. */
  recapAutoSendPaused?: boolean;
  /** Custom/unpaused automatic recap delivery target time. */
  recapAutoSendAt?: Date | null;
  /** Whether automatic recap delivery failed for this departure. */
  recapFailed?: boolean;
  photos?: {
    id: string;
    imageUrl: string;
    caption: string | null;
    diverName: string;
    bookingId: string;
  }[];
  /** Staff photos shared with every diver's recap for the completed departure. */
  crewPhotos?: {
    id: string;
    imageUrl: string;
  }[];
};

/**
 * The slice of `src/db/today.ts`'s `OpenRollCall` this module reads.
 * Structural on purpose: `src/lib` does not import `src/db`, and the gap rows
 * are passed in, never re-derived.
 */
export type CloseoutRollCallGap = {
  tripId: string;
  reason: RollCallGapReason;
  /** 1-based dive number for an after-dive gap, `0` for the dock kinds. */
  diveNumber: number;
  /** People not accounted for at that checkpoint. */
  uncounted: number;
};

export type CloseoutDeparture = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  booked: number;
  /** See `CloseoutTripInput.sailed` — the divers aboard, never the seats sold. */
  sailed: number;
  capacity: number;
  plannedDives: number;
  /** See `CloseoutTripInput.crew` — the assigned crew, at the closing checkpoint. */
  crew: readonly CrewRollCallSubject[];
  /**
   * The open-seats reading, already answered — the ingredients never travel
   * past this point, so no surface can reach a second answer from them. Null
   * when the boat filled, when it never sailed, and when nothing is known.
   */
  openSeats: OpenSeatsDebrief | null;
  planChanges: readonly CloseoutPlanChange[];
  status: CloseoutDepartureStatus;
  /** The headline gap when `status` is `unreconciled`/`count_open`. */
  gapReason: RollCallGapReason | null;
  diveNumber: number;
  uncounted: number;
  /** See `CloseoutTripInput.recapShoutout`. */
  recapShoutout: string | null;
  recapSentAt: Date | null;
  recapAutoSendPaused: boolean;
  recapAutoSendAt: Date | null;
  recapFailed: boolean;
  /**
   * Whether this departure is behind the shop — the same reading `sendDueRecaps`
   * makes about whose recap is due. Only a returned boat is offered the recap
   * note: a trip still out has no day to write about yet, and one that never
   * left has none coming.
   */
  ended: boolean;
  photos: {
    id: string;
    imageUrl: string;
    caption: string | null;
    diverName: string;
    bookingId: string;
  }[];
  crewPhotos: {
    id: string;
    imageUrl: string;
  }[];
};

/** Administrative work attached to the returned boats, expressed as counts. */
export type CloseoutAdminTaskStatus = "complete" | "pending" | "attention";

export type CloseoutAdminTask = {
  id: "post_dive_reports";
  status: CloseoutAdminTaskStatus;
  total: number;
  completed: number;
  pending: number;
  failed: number;
};

/** Keep the task tone derived from its counts, so the page cannot call a partial run complete. */
export function closeoutAdminTaskStatus(input: {
  total: number;
  completed: number;
  pending: number;
  failed: number;
}): CloseoutAdminTaskStatus {
  if (input.failed > 0) return "attention";
  if (input.pending > 0) return "pending";
  return input.completed === input.total ? "complete" : "pending";
}

export type DayCloseoutState = {
  /** The shop-local date being closed, as "YYYY-MM-DD". */
  shopDay: string;
  /** Today's departures, loudest first. */
  departures: CloseoutDeparture[];
  /** Administrative work for the departures that have already returned. */
  adminTasks: CloseoutAdminTask[];
  /**
   * Today's unresolved queue rows — everything `getTodayWork` still raises
   * that is dated today (or undated), minus the roll-call kinds: a head count
   * is never "carried" or "dismissed", it is chased (glossary), and today's
   * counts already stand in the departures list above.
   */
  leftovers: TodayAction[];
  /** The latest explicit choice for each leftover, carried from the append-only trail. */
  leftoverDecisions: Readonly<Record<string, LeftoverDecision>>;
};

const ROLL_CALL_KINDS: ReadonlySet<TodayActionKind> = new Set([
  "roll_call_missing_diver",
  "roll_call_missing_crew",
  "roll_call_unfinished",
  "roll_call_crew_unfinished",
  "roll_call_departure_open",
  "roll_call_not_started",
]);

// A units confirmation is standing shop setup, not work left by today's
// boats. Keeping it out of the closing ledger leaves its single owner — the
// Today desk group — and avoids offering a dismiss action for a fact that
// still needs to be confirmed.
const STANDING_SETUP_KINDS: ReadonlySet<TodayActionKind> = new Set(["units_unconfirmed"]);

/**
 * How one departure reads tonight, in strict precedence: an open head count
 * first, then the clock, and only then the crew's own word — which may settle
 * a station the clock would leave open, and never reopen one it has closed.
 */
function departureStatus(
  trip: CloseoutTripInput,
  gap: CloseoutRollCallGap | undefined,
  now: Date,
): Pick<CloseoutDeparture, "status" | "gapReason" | "diveNumber" | "uncounted"> {
  if (gap) {
    return {
      status: AFTER_DIVE_GAP_REASONS.has(gap.reason) ? "unreconciled" : "count_open",
      gapReason: gap.reason,
      diveNumber: gap.diveNumber,
      uncounted: gap.uncounted,
    };
  }
  const none = { gapReason: null, diveNumber: 0, uncounted: 0 };
  if (!hasSailed(trip.startsAt, now)) {
    return { status: "not_departed", ...none };
  }
  if (!hasReturned(trip.endsAt, now)) {
    // **A crew tap settles a station the clock would leave open; it never
    // reopens one the clock has closed** (issue #1480). The late-arrival hour
    // is there so a *time-based inference* cannot call a boat home early; a
    // crew member tapping Home at the rail is not an inference, it is the
    // statement the buffer was standing in for, so `home` promotes. The
    // asymmetry is the rule and not a hole in it: no stage demotes, and a
    // stale or contrary stage is silence rather than a contradiction.
    // `liveStageOf` is what stops a tap outliving its shelf life
    // (`STAGE_STALE_AFTER_MS` is two buffers).
    //
    // Which leaves the overdue hour — from `endsAt` plus one buffer, where the
    // clock starts saying home, to `endsAt` plus `STAGE_STALE_AFTER_MS`, where
    // the word stops speaking — in which this branch no longer runs, a live
    // `underway` is outvoted, and the departure still reads `all_home`. What
    // keeps that from being a boat lost quietly is the gap branch above, which
    // returns first: this line is only reached over a departure whose head
    // count is complete, every diver counted back aboard, and a shop running
    // no roll call gets `no_roll_call` and never arrives here at all. Read the
    // other way, a tap the crew forgot to update would hold a finished day
    // open until the word went stale.
    //
    // `hasSailed` above carries no matching promotion either: a crew tapping
    // Boarding at 07:50 on an 08:00 boat reads `not_departed` until 09:00.
    // Nothing turns on that — `not_departed` and `still_out` are both
    // unsettled, and neither ends the day — so it stays one clock reading
    // rather than a second rule to keep in step with it.
    const recorded = liveStageOf(trip.stage ?? null, trip.endsAt, now);
    if (recorded?.stage !== "home") {
      return { status: "still_out", ...none };
    }
  }
  return { status: "all_home", ...none };
}

/**
 * Assemble the day's closing state from what the source-of-truth modules
 * already found. `trips` is today's departures in the shop's own calendar day
 * (the db half queries by `shopDayBounds`); `gaps` may cover the whole shop
 * (they are filtered per trip here); `actions` is the Today queue verbatim.
 */
export function assembleDayCloseout(input: {
  trips: readonly CloseoutTripInput[];
  gaps: readonly CloseoutRollCallGap[];
  actions: readonly TodayAction[];
  adminTasks?: readonly CloseoutAdminTask[];
  leftoverDecisions?: Readonly<Record<string, LeftoverDecision>>;
  timeZone: string;
  now?: Date;
}): DayCloseoutState {
  const now = input.now ?? nowDate();
  const today = shopDayBounds(now, input.timeZone);
  const shopDay = shopDayOf(now, input.timeZone);

  const worstGapByTrip = new Map<string, CloseoutRollCallGap>();
  for (const gap of input.gaps) {
    const current = worstGapByTrip.get(gap.tripId);
    if (!current || GAP_REASON_RANK[gap.reason] < GAP_REASON_RANK[current.reason]) {
      worstGapByTrip.set(gap.tripId, gap);
    }
  }

  const departures = input.trips
    .map((trip) => ({
      tripId: trip.tripId,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      booked: trip.booked,
      sailed: trip.sailed,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      crew: trip.crew,
      openSeats: openSeatsDebrief(
        {
          capacity: trip.capacity,
          booked: trip.booked,
          startsAt: trip.startsAt,
          timeZone: input.timeZone,
          lastBookingAt: trip.lastBookingAt ?? null,
          dealSent: trip.dealSent ?? false,
          comparable: trip.comparable ?? null,
        },
        now,
      ),
      planChanges: trip.planChanges ?? [],
      recapShoutout: trip.recapShoutout,
      recapSentAt: trip.recapSentAt ?? null,
      recapAutoSendPaused: trip.recapAutoSendPaused ?? false,
      recapAutoSendAt: trip.recapAutoSendAt ?? null,
      recapFailed: trip.recapFailed ?? false,
      ended: trip.endsAt <= now,
      photos: trip.photos ?? [],
      crewPhotos: trip.crewPhotos ?? [],
      ...departureStatus(trip, worstGapByTrip.get(trip.tripId), now),
    }))
    .sort(
      (a, b) =>
        CLOSEOUT_STATUS_RANK[a.status] - CLOSEOUT_STATUS_RANK[b.status] ||
        a.startsAt.getTime() - b.startsAt.getTime() ||
        a.title.localeCompare(b.title),
    );

  // **Today's own open rows, and nothing else.** Tomorrow used to be counted
  // here too, for a parting-glance card that no longer exists: the spine's own
  // Tomorrow disclosure is what the evening ends on now (ADR
  // 20260827-clearwater-surface-language, decision 4), and it is built from
  // the queue rather than from a second tally of it.
  const carriable = input.actions.filter(
    (action) => !ROLL_CALL_KINDS.has(action.kind) && !STANDING_SETUP_KINDS.has(action.kind),
  );
  const leftovers = sortActions(
    carriable.filter((action) => action.dueAt === null || action.dueAt < today.to),
  );

  return {
    shopDay,
    departures,
    adminTasks: [...(input.adminTasks ?? [])],
    leftovers,
    leftoverDecisions: Object.fromEntries(
      leftovers.flatMap((action) => {
        const decision = input.leftoverDecisions?.[action.id];
        return decision === "carry" || decision === "dismiss" ? [[action.id, decision]] : [];
      }),
    ),
  };
}

/**
 * The shop-local date of `now` as "YYYY-MM-DD" — the day a close row names.
 * The same reading `src/db/today.ts`'s `shopDay` makes, through the same
 * DST-safe wall-clock conversion (`src/lib/zoned.ts`).
 */
export function shopDayOf(now: Date, timeZone: string): string {
  return toDateInputValue(utcToWallTime(now, timeZone));
}

/** What the closer chose to do with one leftover. Carrying is the default —
 * the item stays visible; dismissing only *records* the choice. Neither one
 * filters tomorrow's queue, which keeps re-deriving from the source of truth. */
export type LeftoverDecision = "carry" | "dismiss";

export type CloseoutSnapshotDeparture = {
  tripId: string;
  title: string;
  status: Exclude<CloseoutDepartureStatus, "all_home">;
  gapReason: RollCallGapReason | null;
  uncounted: number;
};

export type CloseoutSnapshotLeftover = {
  id: string;
  kind: TodayActionKind;
  subject: string;
  detail: string;
  decision: LeftoverDecision;
};

export type CloseoutSnapshotAdminTask = Pick<
  CloseoutAdminTask,
  "id" | "status" | "total" | "completed" | "pending" | "failed"
>;

/**
 * What the recorded act remembers: the not-yet-settled departures and every
 * leftover with the choice made about it. Subjects and details are stored as
 * the record of what was on screen when the day closed — trail text, like
 * the `activity_events` trail, not localized UI copy.
 */
export type CloseoutSnapshot = {
  departures: CloseoutSnapshotDeparture[];
  leftovers: CloseoutSnapshotLeftover[];
  /** Administrative work still open when the close was recorded. */
  adminTasks: CloseoutSnapshotAdminTask[];
};

/**
 * Build the snapshot the close act records, from the state as recomputed at
 * close time — never from anything the form claimed. Unknown decision ids are
 * ignored; a leftover with no stated decision is carried, because carrying is
 * the choice that loses nothing.
 */
export function buildCloseoutSnapshot(
  state: Pick<DayCloseoutState, "departures" | "leftovers"> &
    Partial<Pick<DayCloseoutState, "adminTasks" | "leftoverDecisions">>,
  decisions: Readonly<Record<string, LeftoverDecision>> = {},
): CloseoutSnapshot {
  const effectiveDecisions = { ...(state.leftoverDecisions ?? {}), ...decisions };
  return {
    departures: state.departures
      .filter(
        (
          departure,
        ): departure is CloseoutDeparture & { status: CloseoutSnapshotDeparture["status"] } =>
          departure.status !== "all_home",
      )
      .map((departure) => ({
        tripId: departure.tripId,
        title: departure.title,
        status: departure.status,
        gapReason: departure.gapReason,
        uncounted: departure.uncounted,
      })),
    leftovers: state.leftovers.map((action) => ({
      id: action.id,
      kind: action.kind,
      subject: action.subject,
      detail: action.detail,
      decision:
        Object.hasOwn(effectiveDecisions, action.id) && effectiveDecisions[action.id] === "dismiss"
          ? "dismiss"
          : "carry",
    })),
    adminTasks: (state.adminTasks ?? []).map((task) => ({
      id: task.id,
      status: task.status,
      total: task.total,
      completed: task.completed,
      pending: task.pending,
      failed: task.failed,
    })),
  };
}

const DEPARTURE_STATUSES = new Set<string>(Object.keys(CLOSEOUT_STATUS_RANK));
const GAP_REASONS = new Set<string>(Object.keys(GAP_REASON_RANK));

/**
 * Read a snapshot back off a stored jsonb value. Defensive by design — the
 * column is written only by `buildCloseoutSnapshot`, but a trail that renders
 * for years must not crash the page over one malformed historical row.
 * Malformed entries are dropped, never guessed at.
 */
export function parseCloseoutSnapshot(value: unknown): CloseoutSnapshot {
  const empty: CloseoutSnapshot = { departures: [], leftovers: [], adminTasks: [] };
  if (typeof value !== "object" || value === null) return empty;
  const raw = value as { departures?: unknown; leftovers?: unknown; adminTasks?: unknown };
  const departures = Array.isArray(raw.departures)
    ? raw.departures.flatMap((entry): CloseoutSnapshotDeparture[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const row = entry as Record<string, unknown>;
        if (
          typeof row.tripId !== "string" ||
          typeof row.title !== "string" ||
          typeof row.status !== "string" ||
          !DEPARTURE_STATUSES.has(row.status) ||
          row.status === "all_home"
        ) {
          return [];
        }
        return [
          {
            tripId: row.tripId,
            title: row.title,
            status: row.status as CloseoutSnapshotDeparture["status"],
            gapReason:
              typeof row.gapReason === "string" && GAP_REASONS.has(row.gapReason)
                ? (row.gapReason as RollCallGapReason)
                : null,
            uncounted: typeof row.uncounted === "number" ? row.uncounted : 0,
          },
        ];
      })
    : [];
  const leftovers = Array.isArray(raw.leftovers)
    ? raw.leftovers.flatMap((entry): CloseoutSnapshotLeftover[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const row = entry as Record<string, unknown>;
        if (
          typeof row.id !== "string" ||
          typeof row.kind !== "string" ||
          typeof row.subject !== "string" ||
          typeof row.detail !== "string"
        ) {
          return [];
        }
        return [
          {
            id: row.id,
            kind: row.kind as TodayActionKind,
            subject: row.subject,
            detail: row.detail,
            decision: row.decision === "dismiss" ? "dismiss" : "carry",
          },
        ];
      })
    : [];
  const adminTasks = Array.isArray(raw.adminTasks)
    ? raw.adminTasks.flatMap((entry): CloseoutSnapshotAdminTask[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const row = entry as Record<string, unknown>;
        if (
          row.id !== "post_dive_reports" ||
          (row.status !== "complete" && row.status !== "pending" && row.status !== "attention") ||
          !Number.isInteger(row.total) ||
          !Number.isInteger(row.completed) ||
          !Number.isInteger(row.pending) ||
          !Number.isInteger(row.failed) ||
          (row.total as number) < 0 ||
          (row.completed as number) < 0 ||
          (row.pending as number) < 0 ||
          (row.failed as number) < 0
        ) {
          return [];
        }
        return [
          {
            id: "post_dive_reports",
            status: row.status as CloseoutAdminTaskStatus,
            total: row.total as number,
            completed: row.completed as number,
            pending: row.pending as number,
            failed: row.failed as number,
          },
        ];
      })
    : [];
  return { departures, leftovers, adminTasks };
}

/**
 * **One departure of the shop day, as the evening reads it** — ADR
 * 20260827-clearwater-surface-language, decision 4.
 *
 * A settled station is a *reduced* reading of the same departure the morning
 * showed in full: the time, the title, how the head count ended, the recap and
 * the log. The site, the hull, the crew line, the price and the capacity meter
 * are morning facts — they answer "can this boat sail?", and by the evening
 * nobody is asking.
 */
export type StationClose = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * **The whole evening turns on this one boolean.** A station settles when
   * its head count has closed, or when its scheduled return is an hour behind
   * it ({@link DEPARTURE_BUFFER_MS}). Until then the boat is out, and the day
   * cannot close over it.
   */
  settled: boolean;
  status: CloseoutDepartureStatus;
  /** The headline gap, carried through so the station can say what is open. */
  gapReason: RollCallGapReason | null;
  diveNumber: number;
  uncounted: number;
  /** The roster the day is judged against — non-cancelled bookings. */
  booked: number;
  /**
   * **The divers this station sent out** — see `CloseoutTripInput.sailed`.
   *
   * The homecoming numbers are built from this and never from `booked`, at
   * both scales: the day's sentence and the station's own sentence say the
   * same thing about one boat, and reading two different counts is how they
   * would come to disagree (issue #1689).
   */
  sailed: number;
  /**
   * **{@link sailed} less the headline gap's own count** — not a head count of
   * everyone who came back.
   *
   * Only an **after-dive** gap subtracts: those are the reasons that can mean
   * a person is still in the water (`AFTER_DIVE_GAP_REASONS`). A dock-count
   * gap means the *departure* count was never closed, which is paperwork about
   * who got on the boat rather than a claim about who did not get off it — so
   * it leaves this number alone and says so through `status` instead.
   *
   * **It subtracts one gap, because there is only ever one to subtract.**
   * `listRollCallGaps` emits at most one diver row per trip, reporting the
   * first dive that has one and ranking `missing_diver` above
   * `after_dive_uncounted` — so a boat missing one diver after dive 1 and a
   * *different* diver after dive 2 subtracts 1 and reads one too high. That is
   * safe rather than correct: such a station is `unreconciled`, `allHome` is
   * false, and the sentence on screen is the gap reason's own rather than these
   * numbers. Widening it would mean a second gap reader, which is the thing
   * this file exists not to have (issue #1689's review, finding 8).
   */
  back: number;
  /**
   * **Crew this station sent out** — the trip's assigned crew less the ones a
   * human recorded ashore at the dock (`crewAshore`, src/lib/manifests.ts;
   * issue #1689).
   *
   * Assigned was the wrong number for a sentence about who came home, and the
   * dock reality that reaches it is a last-minute crew change: swap a
   * divemaster at 07:00, the crew mark the original ashore, and `changeTripCrew`
   * refuses to unassign anybody who has roll-call history — so they stay
   * assigned forever and the evening counted them out *and* back. "Souls on
   * board" is how many people the vessel *left with* (glossary), and a
   * divemaster standing on the dock is precisely the body that term exists to
   * keep out of it. Zero is its own open state: `crewIsAccountedFor` makes the
   * same subtraction before it grants the moment.
   */
  crewSailed: number;
  /**
   * Whether every assigned crew member is accounted for at the closing
   * checkpoint, through the *same* predicate the manifest asks
   * ({@link crewIsAccountedFor}). False on a trip that named nobody, and false
   * on a shop that has never tapped a crew roll call — in both cases the
   * station keeps its diver-only sentence rather than claiming souls it cannot
   * count.
   */
  crewAccountedFor: boolean;
  /** Crew who sailed and whom the closing checkpoint brought back. */
  crewBack: number;
  /** See `CloseoutDeparture.openSeats`. Null when the boat filled. */
  openSeats: OpenSeatsDebrief | null;
  /** Dives whose actual site was not the planned one. */
  planChanges: readonly CloseoutPlanChange[];
  recapSentAt: Date | null;
  /** Behind the shop — the same reading `sendDueRecaps` makes about a due recap. */
  ended: boolean;
};

/**
 * The day's closing state, as the spine renders it.
 *
 * Every number here is a **sum of what {@link assembleDayCloseout} already
 * decided**, never a second reading of the water. That is the same rule the
 * rest of this file keeps, and it is what stops the home's evening sentence
 * from disagreeing with the station it sits above.
 */
export type EveningClose = {
  /** Every departure of the shop day, clock order — settled or still out. */
  stations: StationClose[];
  /**
   * Whether the closing block may render at all: at least one departure, and
   * every one of them settled. **The pin.** While one boat is out there is no
   * leftovers group, no closing act, and nothing on the page suggesting the
   * day is over.
   */
  closing: boolean;
  /**
   * **Souls the day sent out** — divers and crew, across every departure
   * (issue #1346; ADR 20260904-reef-all-the-way-down, slice 16h). Tabular
   * figures.
   *
   * It counted seats until 2026-09-05: a sum of non-cancelled bookings, which
   * put the crew in neither number on a sentence whose whole subject is who
   * came home. The people most reliably still in the water at the end of a day
   * are the crew, and the homecoming line was the one sentence in the product
   * that left them out.
   */
  out: number;
  /** Souls the head counts brought back. */
  back: number;
  /**
   * The diver half of {@link out}, for a sentence that names both.
   *
   * **Divers who sailed, not seats that were sold** (issue #1689; the rule is
   * {@link seatSailed}). A seat the crew marked `not_boarded` at the dock, or
   * the desk marked `no_show`, is the shop's own word that the person was not
   * aboard, and while this summed `booked` the sentence counted them out *and*
   * back — both numbers moving together, so even `out === back` held and the
   * moment below was still spent.
   */
  divers: number;
  /**
   * The crew half of {@link out} — the crew the day's boats **carried**, never
   * the crew they rostered (issue #1689; see {@link StationClose.crewSailed}).
   */
  crew: number;
  /**
   * The evening's earned moment: the day is closing and every head count
   * closed clean. Condition-derived and self-expiring, like every other row of
   * the ADR's coral table — never stored, never decorative. A day that sent
   * nobody out has nothing to celebrate, so `out` must be positive.
   *
   * **Every station's status has to be `all_home`, not merely `out === back`.**
   * A dock count that was never closed leaves `back` equal to `sailed` by
   * arithmetic — the gap is about who got *on* the boat, so it subtracts
   * nothing — and a sentence saying "10 out, 10 back" over a boat nobody
   * counted is a claim the shop's own records do not support. The moment is
   * rare on purpose; spending it on an unverified day is worse than not
   * spending it.
   *
   * **And every station's assigned crew has to be accounted for** (issue
   * #1346). `status` comes from `listRollCallGaps`, whose crew population is
   * only crew who *already have a result* — so a shop that has never tapped a
   * crew roll call could never raise a crew gap, and this line said every boat
   * was home while the same boat's manifest said `crew_awaiting`. The fix
   * narrows the moment rather than the gap reader: tightening
   * `listRollCallGaps` would raise a danger-toned `crew_uncounted` row on every
   * departure of every shop that has not adopted crew roll call, which is the
   * saturation failure DOM-H3's split exists to avoid. So the gaps stay as they
   * are, and the *celebration* asks {@link crewIsAccountedFor} — the manifest's
   * own predicate — before it spends the accent.
   */
  allHome: boolean;
};

/**
 * Join the day's departures to the clock, in one pass.
 *
 * `departures` is {@link assembleDayCloseout}'s own list — the whole shop day,
 * backwards-looking, which is what lets a boat that sailed at dawn still have
 * a station at 11 p.m. The morning spine's stations come from a
 * forward-looking reader and drop a departure an hour after it leaves; this is
 * the half that catches it again, so the day reads as one row of stations
 * settling rather than a board quietly emptying.
 */
export function assembleEveningClose(
  departures: readonly CloseoutDeparture[],
  now: Date = nowDate(),
): EveningClose {
  const stations: StationClose[] = departures
    .map((departure) => {
      const settled = departure.status === "all_home" || hasReturned(departure.endsAt, now);
      const missing =
        departure.gapReason !== null && AFTER_DIVE_GAP_REASONS.has(departure.gapReason)
          ? departure.uncounted
          : 0;
      // The last checkpoint of the trip's own plan — never a hand-built
      // `after_dive_N`, so a four-dive day and a one-dive day are read by the
      // same rule (`rollCallCheckpoints`, src/lib/roll-call.ts).
      const closingCheckpoint = rollCallCheckpoints(departure.plannedDives).at(-1) ?? "departure";
      const crewCounts = crewRollCallCounts(closingCheckpoint, departure.crew);
      // **Both halves of the sentence count who was carried** (issue #1689). A
      // rostered hand the crew recorded ashore at the dock is not a body the
      // boat left with, and reading `crewAssigned` put them in `out` and in
      // `back` at once — so the arithmetic came out even and the moment was
      // granted over a divemaster standing on the dock. This is the same
      // subtraction `crewIsAccountedFor` already makes below, on the same
      // counts, which is what keeps the number and the verdict in step.
      const crewSailed = Math.max(0, crewCounts.crewAssigned - crewCounts.crewAshore);
      return {
        tripId: departure.tripId,
        title: departure.title,
        startsAt: departure.startsAt,
        endsAt: departure.endsAt,
        settled,
        status: departure.status,
        gapReason: departure.gapReason,
        diveNumber: departure.diveNumber,
        uncounted: departure.uncounted,
        booked: departure.booked,
        sailed: departure.sailed,
        back: Math.max(0, departure.sailed - missing),
        crewSailed,
        crewAccountedFor: crewIsAccountedFor(closingCheckpoint, departure.crew),
        crewBack: Math.max(0, crewSailed - crewCounts.crewNotBackAboard),
        openSeats: departure.openSeats,
        planChanges: departure.planChanges,
        recapSentAt: departure.recapSentAt,
        ended: departure.ended,
      };
    })
    .sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() ||
        a.endsAt.getTime() - b.endsAt.getTime() ||
        a.tripId.localeCompare(b.tripId),
    );
  const divers = stations.reduce((total, station) => total + station.sailed, 0);
  const crew = stations.reduce((total, station) => total + station.crewSailed, 0);
  const out = divers + crew;
  const back = stations.reduce((total, station) => total + station.back + station.crewBack, 0);
  const closing = stations.length > 0 && stations.every((station) => station.settled);
  const allHome =
    closing &&
    out > 0 &&
    out === back &&
    stations.every((station) => station.status === "all_home") &&
    stations.every((station) => station.crewAccountedFor);
  return { stations, closing, out, back, divers, crew, allHome };
}
