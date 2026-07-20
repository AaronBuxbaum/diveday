import type { ReadinessBlocker, ReadinessBlockerCode } from "./readiness";

/**
 * The Today page is a work queue, not a dashboard. Everything on it is either
 * something staff can act on right now, or a timely fact that no other surface
 * makes obvious in one click. Counts that only describe the shop ("upcoming
 * trips", "open seats") belong on Schedule; navigation belongs in the nav.
 *
 * This module is the framework-free half: it turns source-of-truth evidence
 * into ranked, human-readable actions. It never queries; `src/db/today.ts`
 * gathers the facts and calls in here.
 */

/** How soon the work has to be done, derived from the departure it belongs to. */
export type TodayUrgency = "now" | "soon" | "later";

export const URGENCY_LABELS = {
  now: "Before today’s boats",
  soon: "Next 3 days",
  later: "This week",
} as const satisfies Record<TodayUrgency, string>;

const URGENCY_RANK: Record<TodayUrgency, number> = { now: 0, soon: 1, later: 2 };

const HOUR = 60 * 60 * 1000;
/** Anything departing inside a day is "get it done now" work. */
const NOW_WINDOW_MS = 24 * HOUR;
const SOON_WINDOW_MS = 72 * HOUR;
/** The queue never looks further out than this; beyond it, Schedule is the tool. */
export const TODAY_HORIZON_MS = 7 * 24 * HOUR;

export type TodayActionKind =
  | "medical_review"
  | "certification"
  | "waiver"
  | "payment"
  | "readiness_unavailable"
  | "requirements"
  | "gear_packing"
  | "gear_service"
  | "instructor_missing"
  | "waitlist_seat"
  | "email_delivery";

/**
 * Severity breaks ties inside a single departure. It ranks by how long the fix
 * takes to land, not by how bad it looks: evidence that has to come from the
 * diver or a physician outranks anything staff can settle at the dock.
 */
const KIND_SEVERITY: Record<TodayActionKind, number> = {
  medical_review: 0,
  readiness_unavailable: 1,
  certification: 2,
  requirements: 3,
  waiver: 4,
  instructor_missing: 5,
  gear_service: 6,
  gear_packing: 7,
  payment: 8,
  email_delivery: 9,
  waitlist_seat: 10,
};

/**
 * The chip that labels each row. Tone is supplementary: the label always names
 * the state in words, so colour never carries the meaning on its own
 * (design/principles.md #6).
 */
export const ACTION_KIND_META = {
  medical_review: { label: "Medical", tone: "danger" },
  readiness_unavailable: { label: "Readiness", tone: "danger" },
  certification: { label: "Cards", tone: "warning" },
  requirements: { label: "Setup", tone: "warning" },
  waiver: { label: "Waiver", tone: "warning" },
  instructor_missing: { label: "Crew", tone: "warning" },
  gear_service: { label: "Service", tone: "warning" },
  gear_packing: { label: "Gear", tone: "neutral" },
  payment: { label: "Payment", tone: "neutral" },
  email_delivery: { label: "Email", tone: "neutral" },
  waitlist_seat: { label: "Wait list", tone: "neutral" },
} as const satisfies Record<
  TodayActionKind,
  { label: string; tone: "danger" | "warning" | "neutral" }
>;

export type TodayAction = {
  /** Stable across renders so the list can be diffed and tested. */
  id: string;
  kind: TodayActionKind;
  urgency: TodayUrgency;
  /** Who or what the work is about — usually a diver's name. */
  subject: string;
  /** Where and when it lands. The reason this is timely. */
  context: string | null;
  /** What is wrong, in staff language. */
  detail: string;
  /** A verb. What the button does. */
  actionLabel: string;
  href: string;
  /** The departure this hangs off; drives urgency and ordering. */
  dueAt: Date | null;
};

/**
 * Blocked divers are the reason this page exists, so each blocker resolves to
 * the one surface that actually fixes it. Card evidence lives on the person
 * record; waiver, payment, and requirement work lives on the trip roster.
 */
export const BLOCKER_ACTIONS: Record<
  ReadinessBlockerCode,
  {
    kind: TodayActionKind;
    actionLabel: string;
    /** The verb when one row stands for several divers on the same boat. */
    groupLabel: string;
    target: "trip" | "diver";
  }
> = {
  requirements_not_configured: {
    kind: "requirements",
    actionLabel: "Set requirements",
    groupLabel: "Set requirements",
    target: "trip",
  },
  waiver_not_sent: {
    kind: "waiver",
    actionLabel: "Send waiver",
    groupLabel: "Send waivers",
    target: "trip",
  },
  waiver_pending: {
    kind: "waiver",
    actionLabel: "Nudge waiver",
    groupLabel: "Nudge waivers",
    target: "trip",
  },
  waiver_expired: {
    kind: "waiver",
    actionLabel: "Reissue waiver",
    groupLabel: "Reissue waivers",
    target: "trip",
  },
  medical_review: {
    kind: "medical_review",
    actionLabel: "Review medical",
    groupLabel: "Review medicals",
    target: "trip",
  },
  certification_missing: {
    kind: "certification",
    actionLabel: "Add card",
    groupLabel: "Review cards",
    target: "diver",
  },
  certification_pending: {
    kind: "certification",
    actionLabel: "Verify card",
    groupLabel: "Verify cards",
    target: "diver",
  },
  certification_rejected: {
    kind: "certification",
    actionLabel: "Review card",
    groupLabel: "Review cards",
    target: "diver",
  },
  certification_expired: {
    kind: "certification",
    actionLabel: "Update card",
    groupLabel: "Update cards",
    target: "diver",
  },
  certification_insufficient: {
    kind: "certification",
    actionLabel: "Review card",
    groupLabel: "Review cards",
    target: "diver",
  },
  specialty_missing: {
    kind: "certification",
    actionLabel: "Add specialty",
    groupLabel: "Review specialties",
    target: "diver",
  },
  specialty_pending: {
    kind: "certification",
    actionLabel: "Verify specialty",
    groupLabel: "Verify specialties",
    target: "diver",
  },
  specialty_rejected: {
    kind: "certification",
    actionLabel: "Review specialty",
    groupLabel: "Review specialties",
    target: "diver",
  },
  specialty_expired: {
    kind: "certification",
    actionLabel: "Update specialty",
    groupLabel: "Update specialties",
    target: "diver",
  },
  nitrox_missing: {
    kind: "certification",
    actionLabel: "Add nitrox card",
    groupLabel: "Review nitrox cards",
    target: "diver",
  },
  nitrox_pending: {
    kind: "certification",
    actionLabel: "Verify nitrox card",
    groupLabel: "Verify nitrox cards",
    target: "diver",
  },
  nitrox_rejected: {
    kind: "certification",
    actionLabel: "Review nitrox card",
    groupLabel: "Review nitrox cards",
    target: "diver",
  },
  payment_due: {
    kind: "payment",
    actionLabel: "Take payment",
    groupLabel: "Take payments",
    target: "trip",
  },
  readiness_unavailable: {
    kind: "readiness_unavailable",
    actionLabel: "Check readiness",
    groupLabel: "Check readiness",
    target: "trip",
  },
};

export function urgencyFor(dueAt: Date | null, now: Date): TodayUrgency {
  if (!dueAt) return "later";
  const delta = dueAt.getTime() - now.getTime();
  if (delta <= NOW_WINDOW_MS) return "now";
  if (delta <= SOON_WINDOW_MS) return "soon";
  return "later";
}

/**
 * A diver with three blockers is one piece of work, not three rows. The queue
 * shows the hardest blocker as the headline and keeps the rest as detail, so a
 * single person can't flood the list.
 */
export function primaryBlocker(blockers: readonly ReadinessBlocker[]): ReadinessBlocker | null {
  let best: ReadinessBlocker | null = null;
  for (const blocker of blockers) {
    if (!best) {
      best = blocker;
      continue;
    }
    const candidate = KIND_SEVERITY[BLOCKER_ACTIONS[blocker.code].kind];
    if (candidate < KIND_SEVERITY[BLOCKER_ACTIONS[best.code].kind]) best = blocker;
  }
  return best;
}

export type DiverBlockerInput = {
  bookingId: string;
  personId: string;
  fullName: string;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  blockers: readonly ReadinessBlocker[];
};

/**
 * One action per blocked diver, pointed at the surface that clears the
 * headline blocker. Extra blockers ride along in the detail line so staff know
 * whether one tap finishes the person or only starts them.
 */
export function diverBlockerAction(
  input: DiverBlockerInput,
  shopSlug: string,
  now: Date,
): TodayAction | null {
  const blocker = primaryBlocker(input.blockers);
  if (!blocker) return null;
  const { kind, actionLabel, target } = BLOCKER_ACTIONS[blocker.code];
  const remaining = input.blockers.length - 1;
  return {
    id: `blocker:${input.bookingId}:${blocker.code}`,
    kind,
    urgency: urgencyFor(input.startsAt, now),
    subject: input.fullName,
    context: input.tripTitle,
    detail:
      remaining > 0
        ? `${blocker.message} ${remaining} other ${remaining === 1 ? "blocker" : "blockers"} to clear too.`
        : blocker.message,
    actionLabel,
    href:
      target === "diver"
        ? `/shop/${shopSlug}/divers/${input.personId}`
        : `/shop/${shopSlug}/trips/${input.tripId}#booking-${input.bookingId}`,
    dueAt: input.startsAt,
  };
}

/** "Ana, Ben and 6 others" — enough to recognise the group, short enough to scan. */
function nameList(names: readonly string[], shown = 2): string {
  if (names.length <= shown + 1) {
    if (names.length === 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }
  const rest = names.length - shown;
  return `${names.slice(0, shown).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/**
 * Nine divers on one boat all missing a waiver is one job, not nine. Rows are
 * collapsed per departure and per blocker so the queue stays a list of *jobs*;
 * without this, one busy trip buries every other boat's real problem.
 *
 * A lone diver keeps their own row — a named person is more useful than
 * "1 diver", and it can point straight at their record.
 */
export function collapseDiverActions(
  divers: readonly DiverBlockerInput[],
  shopSlug: string,
  now: Date,
): TodayAction[] {
  const byTripAndCode = new Map<string, { blocker: ReadinessBlocker; rows: DiverBlockerInput[] }>();
  for (const diver of divers) {
    const blocker = primaryBlocker(diver.blockers);
    if (!blocker) continue;
    const key = `${diver.tripId}:${blocker.code}`;
    const bucket = byTripAndCode.get(key);
    if (bucket) bucket.rows.push(diver);
    else byTripAndCode.set(key, { blocker, rows: [diver] });
  }

  const actions: TodayAction[] = [];
  for (const [key, { blocker, rows }] of byTripAndCode) {
    const first = rows[0];
    if (!first) continue;
    if (rows.length === 1) {
      const action = diverBlockerAction(first, shopSlug, now);
      if (action) actions.push(action);
      continue;
    }
    const { kind, groupLabel } = BLOCKER_ACTIONS[blocker.code];
    const names = rows.map((row) => row.fullName).sort((a, b) => a.localeCompare(b));
    actions.push({
      id: `blockers:${key}`,
      kind,
      urgency: urgencyFor(first.startsAt, now),
      subject: `${rows.length} divers`,
      context: first.tripTitle,
      detail: `${blocker.message} ${nameList(names)}.`,
      actionLabel: groupLabel,
      // Always the roster: it is the one screen that shows all of them at once.
      href: `/shop/${shopSlug}/trips/${first.tripId}`,
      dueAt: first.startsAt,
    });
  }
  return actions;
}

/**
 * Chronological first: the 7 a.m. boat's problems outrank the 2 p.m. boat's,
 * whatever they are. Severity only decides order inside one departure.
 */
export function sortActions(actions: readonly TodayAction[]): TodayAction[] {
  return [...actions].sort((a, b) => {
    const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (urgency !== 0) return urgency;
    const due =
      (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
    if (due !== 0) return due;
    const severity = KIND_SEVERITY[a.kind] - KIND_SEVERITY[b.kind];
    if (severity !== 0) return severity;
    return a.subject.localeCompare(b.subject);
  });
}

export type TodayActionGroup = {
  urgency: TodayUrgency;
  label: string;
  actions: TodayAction[];
};

/** Only groups with work are returned; an empty heading is noise. */
export function groupActions(actions: readonly TodayAction[]): TodayActionGroup[] {
  const sorted = sortActions(actions);
  return (["now", "soon", "later"] as const)
    .map((urgency) => ({
      urgency,
      label: URGENCY_LABELS[urgency],
      actions: sorted.filter((action) => action.urgency === urgency),
    }))
    .filter((group) => group.actions.length > 0);
}

/**
 * The one-line answer to "how's my day?". Deliberately not a stat grid: it
 * reads as a sentence above the queue instead of four tiles beside it.
 *
 * It leads with people, not rows. Nine divers collapsed into one row is still
 * nine divers who cannot board, and the headline must not shrink that to "1".
 */
export function summarizeDay(
  actions: readonly TodayAction[],
  departures: number,
  blockedToday = 0,
): string {
  const boats =
    departures === 0
      ? "No boats out today"
      : `${departures} ${departures === 1 ? "departure" : "departures"} today`;
  if (blockedToday > 0) {
    return `${boats}. ${blockedToday} ${blockedToday === 1 ? "diver" : "divers"} still can’t board.`;
  }
  if (actions.length === 0) return `${boats} — and nothing is waiting on you.`;
  const urgent = actions.filter((action) => action.urgency === "now").length;
  if (urgent > 0) {
    return `${boats}. ${urgent} ${urgent === 1 ? "job" : "jobs"} to clear before they sail.`;
  }
  return `${boats}. Nothing is urgent; ${actions.length} ${actions.length === 1 ? "job" : "jobs"} to work ahead.`;
}
