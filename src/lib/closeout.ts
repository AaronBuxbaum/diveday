import { nowDate } from "./clock";
import type { RollCallGapReason, TodayAction, TodayActionKind } from "./today";
import { sortActions } from "./today";
import { shopDayBounds, toDateInputValue, utcToWallTime } from "./zoned";

/**
 * The end-of-day close-out: the evening mirror of the Today queue
 * (`src/lib/today.ts`). Today owns the morning — "can the boats sail, who
 * needs me before they do?" — and nothing used to own 5 p.m. This module
 * answers the closing questions instead: did every boat come home counted,
 * what work from today is still open and what does the shop choose to do
 * about it, and what is waiting tomorrow morning.
 *
 * It is an *assembly*, never a second detector. Every fact here is composed
 * from the outputs the source-of-truth modules already produce — the roll-call
 * gaps `src/db/today.ts`'s `listRollCallGaps` chases, and the `TodayAction`
 * queue `getTodayWork` builds. Re-deriving either rule here is the failure
 * mode this docblock exists to forbid: a close-out that counts a head count
 * differently than the queue that chases it would let the two disagree about
 * whether a person is accounted for.
 *
 * Closing the day is a **ritual, not a gate**. The recorded act (see
 * `buildCloseoutSnapshot`) remembers who closed the day and what was still
 * outstanding, and nothing anywhere may condition on it — not tomorrow's
 * queue, not bookings, nothing. An open head count makes the surface loud and
 * the act deliberate (impossible to close *accidentally*), never impossible.
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
 * kinds 1–4). A departure carrying one of these — or a boat that simply is
 * not home — must be *acknowledged by name* before the day closes: the
 * checkbox is what makes closing over it deliberate rather than accidental.
 * The dock-count reasons stay out on purpose: requiring a nightly "I know"
 * from every shop that never taps a roll call teaches crews to tick boxes
 * unread, which is how the loud states stop being read too.
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

/** One of today's departures, as the db layer hands it in. */
export type CloseoutTripInput = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** Non-cancelled bookings — a fact about the trip, shown beside its state. */
  booked: number;
  /**
   * The crew's post-trip note, as it stands. Carried here because the close-out
   * is where it gets written: the hourly recap scan mails each diver no earlier
   * than four hours after the departure ends, so the evening the boat came in is
   * both the last chance to add "the eagle ray on the second dive" and the one
   * moment someone still remembers it. Null when nothing is written yet.
   */
  recapShoutout: string | null;
  photos?: {
    id: string;
    imageUrl: string;
    caption: string | null;
    diverName: string;
    bookingId: string;
  }[];
  /** Instructor/crew photos kept with the close-out only, never a diver recap by default. */
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
  status: CloseoutDepartureStatus;
  /** The headline gap when `status` is `unreconciled`/`count_open`. */
  gapReason: RollCallGapReason | null;
  diveNumber: number;
  uncounted: number;
  /** See `CloseoutTripInput.recapShoutout`. */
  recapShoutout: string | null;
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

/** The one-line answer to "how did today end?", as a code. */
export type CloseoutShape = "no_departures" | "all_clear" | "outstanding";

/**
 * What tomorrow's queue opens with, as counts — never as rows.
 *
 * The close-out used to re-render tomorrow's `TodayAction`s here, and that was
 * the mistake ADR 20260803-not-ready-is-a-view names one level up: the *same*
 * row is actionable on Today (send the waiver, invite the waitlist, copy the
 * payment link) and was a dumb list here, so the evening surface quietly taught
 * staff that those jobs cannot be touched until morning. A count and one link
 * to Today is the honest shape: the parting glance says how much is waiting and
 * hands the work to the surface that owns it.
 */
export type TomorrowGlance = {
  /** Every queue row dated tomorrow — the number the parting glance states. */
  total: number;
  /** The same rows counted by kind, in queue order (loudest first). */
  byKind: { kind: TodayActionKind; count: number }[];
};

export type DayCloseoutState = {
  /** The shop-local date being closed, as "YYYY-MM-DD". */
  shopDay: string;
  shape: CloseoutShape;
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
  /** How much tomorrow's queue opens with, by kind. Counts, never rows. */
  tomorrow: TomorrowGlance;
  /**
   * The departures that must be acknowledged by name before closing — the
   * after-dive gaps and the boats not home. Empty means the close button
   * needs no checkbox.
   */
  mustAcknowledge: CloseoutDeparture[];
};

const ROLL_CALL_KINDS: ReadonlySet<TodayActionKind> = new Set([
  "roll_call_missing_diver",
  "roll_call_missing_crew",
  "roll_call_unfinished",
  "roll_call_crew_unfinished",
  "roll_call_departure_open",
  "roll_call_not_started",
]);

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
  if (trip.startsAt > now) return { status: "not_departed", ...none };
  if (trip.endsAt > now) return { status: "still_out", ...none };
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
  timeZone: string;
  now?: Date;
}): DayCloseoutState {
  const now = input.now ?? nowDate();
  const today = shopDayBounds(now, input.timeZone);
  // `today.to` is tomorrow's local midnight, so bounds taken *at* it are
  // tomorrow's own day — DST-safe because `shopDayBounds` works on wall time.
  const tomorrowBounds = shopDayBounds(today.to, input.timeZone);
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
      recapShoutout: trip.recapShoutout,
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

  const carriable = input.actions.filter((action) => !ROLL_CALL_KINDS.has(action.kind));
  const leftovers = sortActions(
    carriable.filter((action) => action.dueAt === null || action.dueAt < today.to),
  );
  const tomorrowAll = sortActions(
    carriable.filter(
      (action) =>
        action.dueAt !== null &&
        action.dueAt >= tomorrowBounds.from &&
        action.dueAt < tomorrowBounds.to,
    ),
  );

  const mustAcknowledge = departures.filter(
    (departure) => departure.status === "unreconciled" || departure.status === "still_out",
  );

  const adminTasks = [...(input.adminTasks ?? [])];
  const hasOpenDeparture = departures.some((departure) => departure.status !== "all_home");
  const hasOpenAdminTask = adminTasks.some((task) => task.status !== "complete");
  const shape: CloseoutShape =
    hasOpenDeparture || leftovers.length > 0 || hasOpenAdminTask
      ? "outstanding"
      : departures.length === 0
        ? "no_departures"
        : "all_clear";

  return {
    shopDay,
    shape,
    departures,
    adminTasks,
    leftovers,
    tomorrow: countByKind(tomorrowAll),
    mustAcknowledge,
  };
}

/**
 * Tally already-sorted queue rows by kind. Insertion order is queue order, so
 * the loudest kind is named first and the glance reads in the same priority the
 * morning queue will.
 */
function countByKind(actions: readonly TodayAction[]): TomorrowGlance {
  const counts = new Map<TodayActionKind, number>();
  for (const action of actions) {
    counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
  }
  return {
    total: actions.length,
    byKind: [...counts].map(([kind, count]) => ({ kind, count })),
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
 * `activity_events.message`, not localized UI copy.
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
    Partial<Pick<DayCloseoutState, "adminTasks">>,
  decisions: Readonly<Record<string, LeftoverDecision>>,
): CloseoutSnapshot {
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
        Object.hasOwn(decisions, action.id) && decisions[action.id] === "dismiss"
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
