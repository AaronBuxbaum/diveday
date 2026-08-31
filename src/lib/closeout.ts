import { HOUR_MS, nowDate } from "./clock";
import type { RollCallGapReason, TodayAction, TodayActionKind } from "./today";
import { sortActions } from "./today";
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
 * **The standing late-arrival buffer**, in one place rather than four literals.
 *
 * Trips run late, so every "has it sailed / is it back / is it in the past"
 * question in this app allows an hour past the scheduled time before it
 * answers yes (AGENTS.md's hard rule). The evening's whole shape hangs off it:
 * a station cannot settle, and the closing block cannot appear, until the last
 * departure is an hour past its scheduled return.
 */
export const DEPARTURE_BUFFER_MS = HOUR_MS;

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
  if (trip.startsAt.getTime() + DEPARTURE_BUFFER_MS > now.getTime()) {
    return { status: "not_departed", ...none };
  }
  if (trip.endsAt.getTime() + DEPARTURE_BUFFER_MS > now.getTime()) {
    return { status: "still_out", ...none };
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
   * How many of that roster the head count brought back.
   *
   * Only an **after-dive** gap subtracts: those are the reasons that can mean
   * a person is still in the water (`AFTER_DIVE_GAP_REASONS`). A dock-count
   * gap means the *departure* count was never closed, which is paperwork about
   * who got on the boat rather than a claim about who did not get off it — so
   * it leaves this number alone and says so through `status` instead.
   */
  back: number;
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
  /** Divers the day sent out, across every departure. Tabular figures. */
  out: number;
  /** Divers the head counts brought back. */
  back: number;
  /**
   * The evening's earned moment: the day is closing and every head count
   * closed clean. Condition-derived and self-expiring, like every other row of
   * the ADR's coral table — never stored, never decorative. A day that sent
   * nobody out has nothing to celebrate, so `out` must be positive.
   *
   * **Every station's status has to be `all_home`, not merely `out === back`.**
   * A dock count that was never closed leaves `back` equal to `booked` by
   * arithmetic — the gap is about who got *on* the boat, so it subtracts
   * nothing — and a sentence saying "10 out, 10 back" over a boat nobody
   * counted is a claim the shop's own records do not support. The moment is
   * rare on purpose; spending it on an unverified day is worse than not
   * spending it.
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
      const settled =
        departure.status === "all_home" ||
        departure.endsAt.getTime() + DEPARTURE_BUFFER_MS <= now.getTime();
      const missing =
        departure.gapReason !== null && AFTER_DIVE_GAP_REASONS.has(departure.gapReason)
          ? departure.uncounted
          : 0;
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
        back: Math.max(0, departure.booked - missing),
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
  const out = stations.reduce((total, station) => total + station.booked, 0);
  const back = stations.reduce((total, station) => total + station.back, 0);
  const closing = stations.length > 0 && stations.every((station) => station.settled);
  const allHome =
    closing &&
    out > 0 &&
    out === back &&
    stations.every((station) => station.status === "all_home");
  return { stations, closing, out, back, allHome };
}
