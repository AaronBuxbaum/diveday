import { readinessBlockerText } from "@/i18n/readiness-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import {
  blockerActionLabelText,
  blockerDetailGroupText,
  blockerDetailWithRemainingText,
  diverGroupSubjectText,
  nameListText,
  pointingLabelText,
} from "@/i18n/today-labels";
import { HOUR_MS } from "@/lib/clock";
import type { Role } from "./authz";
import type { CrewIncompleteReason } from "./manifests";
import type { AboardBlockerKind, ReadinessBlocker, ReadinessBlockerCode } from "./readiness";
import { utcToWallTime } from "./zoned";

/**
 * The Today page is a work queue, not a dashboard. Everything on it is either
 * something staff can act on right now, or a timely fact that no other surface
 * makes obvious in one click. Counts that only describe the shop ("upcoming
 * trips", "open seats") belong on Schedule; navigation belongs in the nav.
 *
 * This module is the framework-free half: it turns source-of-truth evidence
 * into ranked, human-readable actions. It never queries; `src/db/today.ts`
 * gathers the facts and calls in here.
 *
 * How far out the queue looks is *not* decided here: the horizon is shared with
 * Not ready and Check-in and lives in `src/lib/operational-window.ts`. The
 * urgency bands below slice that horizon into "how soon"; they never widen it.
 *
 * Words live in the message bundles, not here — `src/i18n/today-labels.ts`
 * maps every code this file produces to its staff-bundle key, and the
 * `src/app`/`src/components` caller does the `t()` call. The one exception is
 * `diverBlockerAction`/`collapseDiverActions` below: they compose a single
 * rendered `TodayAction.detail`/`actionLabel` string, a field several other
 * call sites (`src/db/today.ts`) also fill with a plain string, so it stays
 * `string` rather than forking into a second, code-carrying shape. Those two
 * take a `StaffTranslator`, defaulted to English, and resolve through the same
 * `src/i18n/today-labels.ts` helpers (and `src/i18n/readiness-labels.ts`'s
 * `readinessBlockerText` for the blocker's own sentence) rather than calling
 * `t()` inline.
 */

/** How soon the work has to be done, derived from the departure it belongs to. */
export type TodayUrgency = "imminent" | "now" | "soon" | "later";

const URGENCY_RANK: Record<TodayUrgency, number> = { imminent: 0, now: 1, soon: 2, later: 3 };

/** The next boat out — close enough that "later today" isn't precise enough. */
const IMMINENT_WINDOW_MS = 3 * HOUR_MS;
/** Anything departing inside a day is "get it done today" work. */
const NOW_WINDOW_MS = 24 * HOUR_MS;
const SOON_WINDOW_MS = 72 * HOUR_MS;

export type TodayActionKind =
  | "roll_call_missing_diver"
  | "roll_call_missing_crew"
  | "roll_call_unfinished"
  | "roll_call_crew_unfinished"
  | "roll_call_departure_open"
  | "roll_call_not_started"
  | "medical_review"
  | "identity"
  | "certification"
  | "waiver"
  | "payment"
  | "readiness_unavailable"
  | "requirements"
  | "dive_prep"
  | "nitrox_gate"
  | "high_wind_alert"
  | "instructor_missing"
  | "uncrewed_departure"
  | "crew_below_target"
  | "waitlist_seat"
  | "last_minute_fill"
  | "email_delivery"
  | "emergency_contact"
  | "stuck_payment_operation"
  | "failed_photo_deletion"
  | "owed_refund"
  | "reviews_pending"
  | "gear_overdue"
  | "gear_due_back"
  | "gear_service_due"
  | "staff_credential_due"
  | "units_unconfirmed";

/**
 * Severity breaks ties inside a single departure. It ranks by how long the fix
 * takes to land, not by how bad it looks: evidence that has to come from the
 * diver or a physician outranks anything staff can settle at the dock.
 */
const KIND_SEVERITY: Record<TodayActionKind, number> = {
  // A diver was counted at an after-dive checkpoint and was **not** back aboard.
  // Somebody said so out loud; this is the closest thing the app has to a
  // missing-person report, so nothing outranks it (DOM-H3).
  roll_call_missing_diver: 0,
  // The same statement about a **crew member**: somebody tapped "not back
  // aboard" against a named divemaster, captain or deckhand. It sits beside
  // the diver row rather than below the clerical ones because the crew are the
  // people most reliably in the water — the DM who goes back down for a lost
  // weight belt is the scenario, and before this it reached no surface at all
  // (review 20260803, D1).
  roll_call_missing_crew: 1,
  // An after-dive head count that never closed: nobody said the diver is
  // missing, but nobody said they are aboard either. Every other kind below
  // describes someone who cannot board; these describe someone who may still
  // be in the water.
  roll_call_unfinished: 2,
  /** The same, for a crew member who boarded and has no result after a dive. */
  roll_call_crew_unfinished: 3,
  medical_review: 4,
  readiness_unavailable: 5,
  // An unconfirmed identity can hide a missing medical/cert for a different
  // human, so it ranks with the other hard safety gates, above card/waiver work.
  identity: 6,
  certification: 7,
  requirements: 8,
  waiver: 9,
  instructor_missing: 10,
  // Divers booked, zero in-water crew rostered — course session or fun dive
  // alike (issue #732). Placed directly beside `instructor_missing`: both are
  // the same underlying question, "is anyone qualified assigned to supervise
  // this water time", one scoped to the agency's course ratio and this one to
  // the shop's own divemaster target — and both rank above `nitrox_gate`
  // because nobody in the water outranks a single diver's tank fill. It still
  // sits below every kind above it: those describe one diver's own evidence
  // (a medical flag, an unconfirmed identity, a card) which can take days to
  // resolve, while a shop that notices this row can fix it in one tap on the
  // crew editor if it has anyone free to roster.
  uncrewed_departure: 11,
  nitrox_gate: 12,
  high_wind_alert: 13,
  // The dock-side counts. An unfinished *departure* count is paperwork — the
  // boat is home and nobody was ever unaccounted for in the water — so it
  // deliberately sits far below the after-dive kinds above. Collapsing the
  // two into one row is what turns the red row into wallpaper (DOM-H3).
  roll_call_departure_open: 14,
  roll_call_not_started: 15,
  dive_prep: 16,
  payment: 17,
  email_delivery: 18,
  waitlist_seat: 19,
  // A revenue opportunity, not anything blocking or dock-settleable — ranks
  // with the other purely-commercial rows.
  last_minute_fill: 20,
  // Dock-settleable and never a boarding blocker, so it rides near the bottom.
  emergency_contact: 21,
  // Below-target crewing (issue #732): `divemasterRatioGap`'s own docblock
  // is explicit that the target "binds nothing" and is advice a shop may act
  // on or not, unlike `uncrewed_departure` above, which describes a
  // departure with nobody in the water at all. Ranked with the other purely
  // advisory, non-blocking rows so it reads as a nudge, not a problem.
  crew_below_target: 22,
  // Platform-health chores (task 157) — never a departure blocker, so they
  // sink below every per-diver row when severity is what breaks a tie.
  stuck_payment_operation: 23,
  failed_photo_deletion: 24,
  // Somebody is owed their money back for a departure the shop called off.
  // Ranked above the other two platform-health rows: a diver is waiting on
  // this one, and has already been told the shop would be in touch.
  owed_refund: 25,
  // Divers said something worth publishing; nothing sails or refunds on it.
  reviews_pending: 26,
  // The gear register's rows (ADR 20260815-minimal-gear-register). All
  // counter work, never a boarding blocker — a unit that never came home
  // outranks one due back tonight, and both outrank a bench clock, because
  // that is the order the desk actually chases them in.
  gear_overdue: 27,
  gear_due_back: 28,
  gear_service_due: 29,
  staff_credential_due: 30,
  // Bottom of the queue, and rightly: this is a question nobody has answered
  // rather than anything that has gone wrong. It is here at all because the
  // first-run checklist that asked it stops rendering at the shop's first
  // departure — step 4 of that same checklist — so a shop that scheduled a
  // trip before opening the Units row would never be asked again, and currency
  // decides what a diver's card is charged in (issue #835).
  units_unconfirmed: 31,
};

/**
 * Audience per TodayActionKind (issue #715).
 * Declares which roles act on each kind:
 * - In-water, roll call, dock gear, and prep rows are for all staff.
 * - Instructional staffing, requirements, certs, and waivers are for instructors, owners, and managers.
 * - Front-desk, commercial, financial, and back-office rows are for owners and managers.
 */
export const KIND_AUDIENCE: Record<TodayActionKind, readonly Role[]> = {
  roll_call_missing_diver: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  roll_call_missing_crew: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  roll_call_unfinished: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  roll_call_crew_unfinished: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  roll_call_departure_open: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  roll_call_not_started: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  dive_prep: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  nitrox_gate: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  high_wind_alert: ["owner", "manager", "instructor", "divemaster", "captain"],
  uncrewed_departure: ["owner", "manager", "instructor", "divemaster", "captain"],
  crew_below_target: ["owner", "manager", "instructor", "divemaster", "captain"],
  instructor_missing: ["owner", "manager", "instructor"],
  medical_review: ["owner", "manager", "instructor"],
  identity: ["owner", "manager", "instructor"],
  certification: ["owner", "manager", "instructor"],
  requirements: ["owner", "manager", "instructor"],
  waiver: ["owner", "manager", "instructor"],
  emergency_contact: ["owner", "manager"],
  payment: ["owner", "manager"],
  readiness_unavailable: ["owner", "manager"],
  waitlist_seat: ["owner", "manager"],
  last_minute_fill: ["owner", "manager"],
  email_delivery: ["owner", "manager"],
  stuck_payment_operation: ["owner", "manager"],
  failed_photo_deletion: ["owner", "manager"],
  owed_refund: ["owner", "manager"],
  reviews_pending: ["owner", "manager"],
  gear_overdue: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  gear_due_back: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  gear_service_due: ["owner", "manager", "instructor", "divemaster", "captain", "crew"],
  staff_credential_due: ["owner", "manager"],
  units_unconfirmed: ["owner", "manager"],
};

/**
 * Filters the action queue for the viewer's roles, taking the union for multi-role staff.
 * Owners and managers see everything with zero withheld.
 */
export function filterActionsForRoles(
  actions: readonly TodayAction[],
  roles?: readonly Role[],
): { visibleActions: TodayAction[]; withheldCount: number } {
  if (!roles || roles.length === 0 || roles.includes("owner") || roles.includes("manager")) {
    return { visibleActions: [...actions], withheldCount: 0 };
  }
  const roleSet = new Set(roles);
  const visibleActions: TodayAction[] = [];
  let withheldCount = 0;

  for (const action of actions) {
    const audience = KIND_AUDIENCE[action.kind];
    const canSee = audience ? audience.some((r) => roleSet.has(r)) : true;
    if (canSee) {
      visibleActions.push(action);
    } else {
      withheldCount += 1;
    }
  }

  return { visibleActions, withheldCount };
}

/**
 * The chip that labels each row. Tone only — the word itself lives in
 * `src/i18n/today-labels.ts`'s `ACTION_KIND_KEYS`, so colour never carries the
 * meaning on its own (design/principles.md #6) and the label always comes
 * through `t()`.
 */
export const ACTION_KIND_META = {
  roll_call_missing_diver: { tone: "danger" },
  roll_call_missing_crew: { tone: "danger" },
  roll_call_unfinished: { tone: "danger" },
  roll_call_crew_unfinished: { tone: "danger" },
  // Warning, not danger, and on purpose: an unfinished dock count is missing
  // paperwork. Toning it the same as a diver who never came back is what
  // teaches crews to stop reading the red rows.
  roll_call_departure_open: { tone: "warning" },
  roll_call_not_started: { tone: "warning" },
  medical_review: { tone: "danger" },
  readiness_unavailable: { tone: "danger" },
  identity: { tone: "danger" },
  certification: { tone: "warning" },
  requirements: { tone: "warning" },
  waiver: { tone: "warning" },
  instructor_missing: { tone: "warning" },
  // Same tone as instructor_missing, its fun-dive sibling: nobody is in the
  // water yet, but it is not paperwork either.
  uncrewed_departure: { tone: "warning" },
  nitrox_gate: { tone: "warning" },
  high_wind_alert: { tone: "warning" },
  dive_prep: { tone: "neutral" },
  payment: { tone: "neutral" },
  email_delivery: { tone: "neutral" },
  waitlist_seat: { tone: "neutral" },
  last_minute_fill: { tone: "neutral" },
  emergency_contact: { tone: "neutral" },
  // Neutral, not warning: the target binds nothing and this is advice, not a
  // problem (src/lib/divemaster-ratio.ts).
  crew_below_target: { tone: "neutral" },
  stuck_payment_operation: { tone: "warning" },
  failed_photo_deletion: { tone: "warning" },
  owed_refund: { tone: "warning" },
  reviews_pending: { tone: "neutral" },
  // Warning, not danger: a unit that is late is a phone call, not a diver in
  // the water. Due-back-today and a bench clock are ordinary counter work.
  gear_overdue: { tone: "warning" },
  gear_due_back: { tone: "neutral" },
  gear_service_due: { tone: "neutral" },
  staff_credential_due: { tone: "warning" },
  // Neutral, not warning: the shop is trading on a derived default that is
  // probably right. It wants confirming, not alarming about.
  units_unconfirmed: { tone: "neutral" },
} as const satisfies Record<TodayActionKind, { tone: "danger" | "warning" | "neutral" }>;

/**
 * Why one trip's head count is not closed (DOM-H3). Codes, not sentences: the
 * evidence is gathered in `src/db/today.ts` and the words come from
 * `src/i18n/today-labels.ts`. They are deliberately *not* interchangeable —
 * collapsing them into one row is the defect this type exists to prevent:
 *
 * - `missing_diver` — somebody tapped "not back aboard" at an after-dive
 *   checkpoint. A human said a diver did not return to the boat. Loudest row
 *   the app has.
 * - `missing_crew` — the same statement about a named **crew member** (ADR
 *   20260803-per-person-crew-roll-call). The DM who went back down for a lost
 *   weight belt and has not surfaced is exactly this row, and until it existed
 *   the manifest went red while Today and the schedule board said nothing —
 *   which made the glossary's "an unclosed head count is chased, not merely
 *   displayed" false for the people most reliably in the water (review
 *   20260803, D1).
 * - `after_dive_uncounted` — an after-dive checkpoint where a diver who
 *   *boarded at departure* still has no result. Nobody said they are missing;
 *   nobody said they are aboard either.
 * - `crew_uncounted` — the same, for a crew member who boarded at departure.
 * - `departure_uncounted` — the dock count never finished. The boat is home and
 *   nobody was ever unaccounted for in the water: this is paperwork.
 * - `no_roll_call` — the trip has no roll-call events at all. That is a shop
 *   not using the feature, not a lost diver — but reading it as fine would be a
 *   false all-clear, so it is still stated, quietly.
 *
 * The two crew kinds count the same **population rule** the diver kinds do: only
 * somebody who actually boarded is in the water. A shop that never taps a crew
 * roll call therefore raises no crew rows at all, rather than a danger-toned
 * row on every trip it ever ran — which is the failure mode that stops the red
 * rows being read.
 */
export type RollCallGapReason =
  | "missing_diver"
  | "missing_crew"
  | "after_dive_uncounted"
  | "crew_uncounted"
  | "departure_uncounted"
  | "no_roll_call";

/** Which queue row each gap becomes. One place, so tone and severity can't drift. */
export const ROLL_CALL_GAP_KINDS: Record<RollCallGapReason, TodayActionKind> = {
  missing_diver: "roll_call_missing_diver",
  missing_crew: "roll_call_missing_crew",
  after_dive_uncounted: "roll_call_unfinished",
  crew_uncounted: "roll_call_crew_unfinished",
  departure_uncounted: "roll_call_departure_open",
  no_roll_call: "roll_call_not_started",
};

/**
 * How urgent each gap is. The four after-dive kinds — divers' and crew's alike
 * — are pinned to the top band: there is no "before it sails" left to derive
 * from, and a person may be in the water. The dock-count kinds land in "before
 * today's boats": real work, not an emergency.
 *
 * A `stale` gap (one the shop never closed and can no longer settle on the
 * dock) drops a band rather than disappearing — see `ROLL_CALL_RESIDUE_MS` in
 * `src/db/today.ts`. A signal that self-clears is not a signal. Crew gaps age
 * on exactly the same 48h dock-work / 30-day residue schedule divers' do; a
 * crew member is not less findable than a customer.
 */
export function rollCallGapUrgency(reason: RollCallGapReason, stale: boolean): TodayUrgency {
  if (reason === "departure_uncounted" || reason === "no_roll_call") return "now";
  return stale ? "soon" : "imminent";
}

export type TodayAction = {
  /** Stable across renders so the list can be diffed and tested. */
  id: string;
  kind: TodayActionKind;
  urgency: TodayUrgency;
  /** Who or what the work is about — usually a diver's name. */
  subject: string;
  /** Where and when it lands. The reason this is timely. */
  context: string | null;
  /**
   * The boat this work hangs off, when there is one. The queue groups rows
   * under one departure header per boat and drops each row's own copy of the
   * trip name — a fact shared by every row belongs to the group, not the rows
   * (design/principles.md #9). `label` is the header line, already composed
   * with the departure's local time. Rows with no boat (a stuck payment
   * operation, a media chore) leave this unset and stand alone.
   */
  departure?: { tripId: string; label: string };
  /**
   * True when `subject` *is* the departure (prep gaps, open seats, crew
   * gaps) — under a departure header the row leads with its detail, because
   * repeating the header as the row's subject says the boat twice.
   */
  aboutDeparture?: boolean;
  /** What is wrong, in staff language. */
  detail: string;
  /**
   * The button label. A verb *only* when the tap performs that verb (waiver
   * sends do; everything else points — "Open Priya's record", "Open roster").
   */
  actionLabel: string;
  href: string;
  /**
   * Present when the tap issues and sends a waiver in place rather than
   * navigating. `href` stays the row's real destination — a pre-hydration tap,
   * a middle-click and an open-in-new-tab all still land on the roster row.
   */
  waiver?: { bookingIds: string[] };
  /**
   * Present when the tap re-sends a failed booking confirmation in place. `href`
   * stays the row's real destination (pre-hydration tap, middle-click,
   * open-in-new-tab), the trip.
   */
  resend?: { bookingId: string };
  /**
   * Present on a freed-seat row: the front-of-line wait-list entry plus the
   * context the one-tap invite needs for its composer fallback, so staff can
   * offer the seat straight from the queue instead of navigating to the trip.
   * `href` stays the row's real destination (pre-hydration tap, middle-click,
   * open-in-new-tab), the wait-list section.
   */
  invite?: {
    tripId: string;
    entryId: string;
    personName: string;
    personEmail: string | null;
    invitedAt: Date | null;
    bookingPath: string;
    tripTitle: string;
    tripWhen: string;
  };
  /**
   * Present on a single-diver `payment` row (payment_due/payment_refunded).
   * `orderId`/`hostedInvoiceUrl` start unset here — this module has no DB
   * access — and `src/db/today.ts` fills them in only when that booking was
   * actually invoiced through Stripe and the invoice is still open. The
   * queue renders the inline "copy link"/"resend invoice" control only once
   * `orderId` is present; otherwise the row keeps its `href` fallback to the
   * roster (never a dead button). A collapsed multi-diver row has no single
   * booking to act on, so `collapseDiverActions` never sets this.
   */
  payment?: { bookingId: string; orderId?: string; hostedInvoiceUrl?: string | null };
  /** The departure this hangs off; drives urgency and ordering. */
  dueAt: Date | null;
};

/** The three blocker codes a one-tap send actually resolves. */
const WAIVER_CODES = new Set<ReadinessBlockerCode>([
  "waiver_not_sent",
  "waiver_pending",
  "waiver_expired",
]);

export function isWaiverCode(code: ReadinessBlockerCode): boolean {
  return WAIVER_CODES.has(code);
}

/**
 * Blocked divers are the reason this page exists, so each blocker resolves to
 * the one surface that actually fixes it. Card evidence lives on the person
 * record; waiver, payment, and requirement work lives on the trip roster. The
 * words for `actionLabel`/`groupLabel` live in `src/i18n/today-labels.ts`
 * (`BLOCKER_ACTION_LABEL_KEYS`/`BLOCKER_GROUP_LABEL_KEYS`), keyed by the same
 * `ReadinessBlockerCode` — this map only states kind and target.
 */
export const BLOCKER_ACTIONS: Record<
  ReadinessBlockerCode,
  { kind: TodayActionKind; target: "trip" | "diver" }
> = {
  requirements_not_configured: { kind: "requirements", target: "trip" },
  identity_unconfirmed: { kind: "identity", target: "trip" },
  // Targets the diver: the fix is either a corrected date of birth on their
  // record or a conversation with the family, never a change to the trip.
  under_minimum_age: { kind: "certification", target: "diver" },
  waiver_not_sent: { kind: "waiver", target: "trip" },
  waiver_pending: { kind: "waiver", target: "trip" },
  waiver_expired: { kind: "waiver", target: "trip" },
  medical_review: { kind: "medical_review", target: "trip" },
  certification_missing: { kind: "certification", target: "diver" },
  certification_pending: { kind: "certification", target: "diver" },
  certification_self_declared: { kind: "certification", target: "diver" },
  certification_insufficient: { kind: "certification", target: "diver" },
  specialty_missing: { kind: "certification", target: "diver" },
  specialty_pending: { kind: "certification", target: "diver" },
  // An imported specialty card is one tap from clearing its gate, so this reads
  // as a confirmation, not a card to chase (ADR 20260725-import-specialty-cards).
  specialty_import_unconfirmed: { kind: "certification", target: "diver" },
  nitrox_missing: { kind: "certification", target: "diver" },
  nitrox_pending: { kind: "certification", target: "diver" },
  nitrox_self_declared: { kind: "certification", target: "diver" },
  payment_due: { kind: "payment", target: "trip" },
  payment_refunded: { kind: "payment", target: "trip" },
  readiness_unavailable: { kind: "readiness_unavailable", target: "trip" },
};

export function urgencyFor(dueAt: Date | null, now: Date): TodayUrgency {
  if (!dueAt) return "later";
  const delta = dueAt.getTime() - now.getTime();
  if (delta <= IMMINENT_WINDOW_MS) return "imminent";
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

/**
 * Where a staffer goes to clear a diver's *worst* blocker, and what the link
 * says when they get there.
 *
 * This is the one blocker->destination rule. It used to be six identical lines
 * in two places — here and `blockerFixFor` (`src/lib/blockers.ts`) — kept in
 * step by a comment saying they were kept in step. The two callers are the
 * Today queue and the by-departure blocker view, which sit one tap apart and
 * are meant to agree about a diver (`src/db/blockers.ts` says so at the read);
 * the readiness *data* was already shared, the destination derived from it was
 * not. Each caller still shapes its own result — a `TodayAction` and a
 * `BlockerFix` are different objects with different jobs — but neither decides
 * where the link goes any more.
 *
 * Lives here rather than in `blockers.ts` because `BLOCKER_ACTIONS`,
 * `isWaiverCode` and `primaryBlocker` are all here and `blockers.ts` already
 * imports them; moving the rule the other way would invert that edge.
 */
export type BlockerDestination = {
  blocker: ReadinessBlocker;
  kind: TodayActionKind;
  target: "trip" | "diver";
  sendsWaiver: boolean;
  label: string;
  href: string;
};

export type BlockerDestinationContext = {
  shopSlug: string;
  tripId: string;
  personId: string;
  bookingId: string;
  fullName: string;
};

export function blockerDestination(
  blockers: readonly ReadinessBlocker[],
  ctx: BlockerDestinationContext,
  t: StaffTranslator = staffTranslator("en-US"),
): BlockerDestination | null {
  const blocker = primaryBlocker(blockers);
  if (!blocker) return null;
  const { kind, target } = BLOCKER_ACTIONS[blocker.code];
  const sendsWaiver = isWaiverCode(blocker.code);
  return {
    blocker,
    kind,
    target,
    sendsWaiver,
    // Waiver rows send in place, so they keep the verb; a card row only opens
    // the person record, so it points instead of pretending to act.
    label: sendsWaiver
      ? blockerActionLabelText(t, blocker.code, false)
      : pointingLabelText(t, target, ctx.fullName),
    href:
      target === "diver"
        ? `/shop/${ctx.shopSlug}/divers/${ctx.personId}`
        : `/shop/${ctx.shopSlug}/trips/${ctx.tripId}/guests#booking-${ctx.bookingId}`,
  };
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
 *
 * `t` defaults to English so every existing call site (tests, and any caller
 * that hasn't threaded a request-locale translator through yet) keeps working
 * unchanged; a locale-aware caller passes its own.
 */
export function diverBlockerAction(
  input: DiverBlockerInput,
  shopSlug: string,
  now: Date,
  t: StaffTranslator = staffTranslator("en-US"),
): TodayAction | null {
  const destination = blockerDestination(
    input.blockers,
    {
      shopSlug,
      tripId: input.tripId,
      personId: input.personId,
      bookingId: input.bookingId,
      fullName: input.fullName,
    },
    t,
  );
  if (!destination) return null;
  const { blocker, kind, sendsWaiver } = destination;
  const remaining = input.blockers.length - 1;
  const blockerText = readinessBlockerText(t, blocker);
  return {
    id: `blocker:${input.bookingId}:${blocker.code}`,
    kind,
    urgency: urgencyFor(input.startsAt, now),
    subject: input.fullName,
    context: input.tripTitle,
    departure: { tripId: input.tripId, label: input.tripTitle },
    detail: remaining > 0 ? blockerDetailWithRemainingText(t, blockerText, remaining) : blockerText,
    actionLabel: destination.label,
    href: destination.href,
    ...(sendsWaiver ? { waiver: { bookingIds: [input.bookingId] } } : {}),
    ...(kind === "payment" ? { payment: { bookingId: input.bookingId } } : {}),
    dueAt: input.startsAt,
  };
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
  t: StaffTranslator = staffTranslator("en-US"),
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
      const action = diverBlockerAction(first, shopSlug, now, t);
      if (action) actions.push(action);
      continue;
    }
    const { kind } = BLOCKER_ACTIONS[blocker.code];
    const names = rows.map((row) => row.fullName).sort((a, b) => a.localeCompare(b));
    const waiver = isWaiverCode(blocker.code);
    actions.push({
      id: `blockers:${key}`,
      kind,
      urgency: urgencyFor(first.startsAt, now),
      subject: diverGroupSubjectText(t, rows.length),
      context: first.tripTitle,
      departure: { tripId: first.tripId, label: first.tripTitle },
      detail: blockerDetailGroupText(t, readinessBlockerText(t, blocker), nameListText(t, names)),
      // A batch waiver send keeps the verb ("Send waivers"); any other grouped
      // fix only opens the roster, the one screen that shows all of them.
      actionLabel: waiver
        ? blockerActionLabelText(t, blocker.code, true)
        : pointingLabelText(t, "trip", first.fullName),
      // Always the roster: it is the one screen that shows all of them at once.
      href: `/shop/${shopSlug}/trips/${first.tripId}`,
      ...(waiver ? { waiver: { bookingIds: rows.map((row) => row.bookingId) } } : {}),
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

export type RoleLens = "boat" | "sessions" | null;

/**
 * Which lens Today leads with for the signed-in staffer
 * (20260721-role-aware-landing). Owners and managers triage the whole shop, so
 * they get no lens; instructors lead with their sessions; divemasters and
 * captains lead with their boat. Instructor wins for people holding both,
 * matching the demo switcher's precedence.
 */
export function roleLensFor(roles: readonly Role[]): RoleLens {
  if (roles.includes("owner") || roles.includes("manager")) return null;
  if (roles.includes("instructor")) return "sessions";
  if (roles.includes("divemaster") || roles.includes("captain")) return "boat";
  return null;
}

/** Which seasonal-briefing sentence today's date falls into. */
export type TodaySeason = "summer" | "autumn" | "winter" | "spring";

/**
 * Which seasonal briefing variant the date falls into, based on its month
 * **in the shop's own timezone** — `getMonth()` on the raw Date read the
 * server's (or, in a Client Component, the browser's) local month, which
 * flips the season a day early or late around a month boundary for any shop
 * whose zone straddles the server's midnight. The sentence itself — kept
 * rationed like --accent, reading like a briefing, not filler — lives in
 * `src/i18n/today-labels.ts`'s `seasonalBriefingText`.
 */
export function getSeasonalBriefing(date: Date, timezone: string): TodaySeason {
  const month = utcToWallTime(date, timezone).month - 1; // 0-indexed (0 = Jan, 11 = Dec)
  if (month >= 5 && month <= 7) return "summer"; // June, July, August
  if (month >= 8 && month <= 10) return "autumn"; // September, October, November
  if (month === 11 || month === 0 || month === 1) return "winter"; // December, January, February
  return "spring"; // March, April, May
}

/** Which time-of-day greeting band the shop's local hour falls into. */
export type TodayGreetingBand = "morning" | "afternoon" | "evening" | "night";

/**
 * Which time-of-day-aware greeting band a moment falls into, in the shop's
 * local timezone. The greeting itself — reading like dive briefing copy
 * rather than cutesy filler — lives in `src/i18n/today-labels.ts`'s
 * `GREETING_KEYS`.
 *
 * `night` is a *band*, not a sign-off: from 22:00 it is a staffer still at the
 * desk building tomorrow's board, so the English reads "Working late" rather
 * than "Good night", which in English is what you say on the way out the door.
 * (Spanish has no such split — "buenas noches" is both — so its evening and
 * night strings are allowed to differ in shape from the English pair.)
 */
export function getTimeOfDayGreeting(date: Date, timezone: string): TodayGreetingBand {
  const wall = utcToWallTime(date, timezone);
  const hour = wall.hour;
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/**
 * **The day spine** — ADR 20260827-clearwater-surface-language, decision 4.
 *
 * The shop home stopped being two views over one queue and became one
 * chronological spine: today's departures as stations in clock order, each
 * carrying the work that hangs off it, and everything bound to no boat pooled
 * under one desk group.
 *
 * Everything below is a **re-filing, never a re-detection**. `getTodayWork`
 * (`src/db/today.ts`) is still the one reader and `KIND_SEVERITY` is still the
 * one severity ranking; this decides only *where* each
 * row already produced renders. A `TodayAction` that names a `departure.tripId`
 * files under that trip's station; one that names none files under the desk.
 * A new query, a new blocker rule or a second urgency computation here would
 * be the failure this shape exists to prevent — two answers about one boat.
 *
 * The shapes are structural rather than imported from `src/db/today.ts` for
 * the reason the close-out's own inputs are: `src/lib` never imports `src/db`
 * (`pnpm check:architecture`). The shop home hands this an actual
 * `DepartureSummary[]`, so dropping or retyping a field upstream still fails
 * to compile at that call site.
 */
export type SpineDeparture = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  siteName: string | null;
  boatName: string | null;
  priceCents: number | null;
  capacity: number;
  booked: number;
  boarded: number;
  blocked: number;
  crew: readonly { fullName: string }[];
  /**
   * The two safety facts the departure card carried and the station keeps.
   * They are not queue rows: neither has a fix a staffer taps here, and both
   * describe a checkpoint rather than a job (issues #789 and #791).
   */
  blockedAboardGroups: readonly { kind: AboardBlockerKind; names: readonly string[] }[];
  crewAccountedFor: boolean;
  crewReason: CrewIncompleteReason | null;
};

/**
 * One station of the spine: a departure, and the work that hangs off it. The
 * departure's own fields are spread rather than nested — a station *is* the
 * departure, seen at the time it sails.
 */
export type DayStation = SpineDeparture & {
  /** The crew line, already flattened to names in roster order. */
  crewNames: string[];
  /** This departure's queue rows, severity-ordered. */
  rows: TodayAction[];
};

export type DaySpine = {
  /** Today's departures, clock order. Never re-ordered by the role lens. */
  stations: DayStation[];
  /** Rows bound to no departure — the "At the desk" group. */
  desk: TodayAction[];
  /** The collapsed Tomorrow disclosure's body and count. */
  tomorrow: { stations: DayStation[]; jobs: number };
  /** The rest of the horizon, as one count behind a link to the board. */
  week: { jobs: number };
};

/** Tone first: danger, then warning, then everything quiet. */
const TONE_RANK: Record<"danger" | "warning" | "neutral", number> = {
  danger: 0,
  warning: 1,
  neutral: 2,
};

function toneRank(action: TodayAction): number {
  return TONE_RANK[ACTION_KIND_META[action.kind].tone];
}

/**
 * Severity order inside one station: danger → warning → quiet, then by
 * time-to-departure, then by how long the fix takes to land
 * ({@link KIND_SEVERITY}), then by name so the order is total rather than
 * merely usually-stable.
 */
export function sortStationRows(actions: readonly TodayAction[]): TodayAction[] {
  return [...actions].sort((a, b) => {
    const tone = toneRank(a) - toneRank(b);
    if (tone !== 0) return tone;
    const due =
      (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
    if (due !== 0) return due;
    const severity = KIND_SEVERITY[a.kind] - KIND_SEVERITY[b.kind];
    if (severity !== 0) return severity;
    return a.subject.localeCompare(b.subject);
  });
}

/** What `assembleDaySpine` needs of one `getTodayWork` result. */
export type SpineWork = {
  departures: readonly SpineDeparture[];
  actions: readonly TodayAction[];
};

function stationFor(departure: SpineDeparture, rows: readonly TodayAction[]): DayStation {
  return {
    ...departure,
    crewNames: departure.crew.map((member) => member.fullName),
    rows: sortStationRows(rows),
  };
}

/**
 * Files today's ranked queue onto today's departures.
 *
 * `today` is the shop-day's own `getTodayWork`; `tomorrow` is the second,
 * equally bounded call for the next shop-day, whose *departures* become the
 * Tomorrow disclosure's body. Rows are drawn from `today.actions` for both —
 * the horizon is one queue and a job is counted exactly once, wherever its boat
 * happens to sail.
 *
 * Stations arrive in clock order, and nothing re-orders them: the crew-first
 * ordering the departure board used is deliberately gone,
 * because a spine that puts 1:00 PM above 7:00 AM for one reader is no longer
 * a clock.
 */
export function assembleDaySpine(today: SpineWork, tomorrow: SpineWork): DaySpine {
  const byClock = (a: SpineDeparture, b: SpineDeparture) =>
    a.startsAt.getTime() - b.startsAt.getTime() || a.tripId.localeCompare(b.tripId);
  const todayDepartures = [...today.departures].sort(byClock);
  const tomorrowDepartures = [...tomorrow.departures].sort(byClock);

  const rowsByTrip = new Map<string, TodayAction[]>();
  const desk: TodayAction[] = [];
  for (const action of today.actions) {
    if (!action.departure) {
      desk.push(action);
      continue;
    }
    const bucket = rowsByTrip.get(action.departure.tripId);
    if (bucket) bucket.push(action);
    else rowsByTrip.set(action.departure.tripId, [action]);
  }

  const stations = todayDepartures.map((departure) =>
    stationFor(departure, rowsByTrip.get(departure.tripId) ?? []),
  );
  const tomorrowStations = tomorrowDepartures.map((departure) =>
    stationFor(departure, rowsByTrip.get(departure.tripId) ?? []),
  );

  const placed = new Set([
    ...todayDepartures.map((departure) => departure.tripId),
    ...tomorrowDepartures.map((departure) => departure.tripId),
  ]);
  const weekJobs = today.actions.filter(
    (action) => action.departure && !placed.has(action.departure.tripId),
  ).length;

  return {
    stations,
    desk: sortStationRows(desk),
    tomorrow: {
      stations: tomorrowStations,
      jobs: tomorrowStations.reduce((total, station) => total + station.rows.length, 0),
    },
    week: { jobs: weekJobs },
  };
}

/** Every row the spine holds, wherever it filed. */
export function spineJobCount(spine: DaySpine): number {
  return (
    spine.stations.reduce((total, station) => total + station.rows.length, 0) +
    spine.desk.length +
    spine.tomorrow.jobs +
    spine.week.jobs
  );
}

/**
 * **The whole page is empty at once** (principles.md's whole-page-empty rule):
 * no boat on the spine, nothing waiting anywhere on it, and no presence-derived
 * desk row standing in for work the queue cannot see. The home then collapses
 * to a heading, one sentence and the one act available, rather than rendering a
 * spine of empty groups.
 *
 * `deskPresenceRow` is the honesty clause, and it is the whole reason this is a
 * function rather than a `spineJobCount(spine) === 0` at the call site: the
 * desk group can carry a row that is *not* a queue job — the payments row a
 * shop sees while it cannot take money online (ADR 20260827-first-light,
 * decision 6) — and "nothing is waiting on you" said over one is a lie the
 * reader can see on the same screen.
 *
 * `dayDepartures` is the other honesty clause, and it is why the spine's own
 * station count is not the whole answer. The spine's stations come from a
 * forward-looking reader — a boat is gone from it an hour after it leaves — so
 * an evening whose only departure is already home has an empty `stations` and
 * a page that is anything but quiet: the station settles, the leftovers stand,
 * and the day is waiting to be closed (ADR
 * 20260827-clearwater-surface-language, decision 4). Pass
 * `assembleEveningClose(...).stations.length`, which is the whole shop day.
 *
 * `firstRun` is the third, and it is the one clause that is about a *different*
 * composition rather than about honesty. A shop that has never had a board is
 * not having a quiet day — it is having its first morning, and the setup ledger
 * leads its spine (ADR 20260827-first-light, decision 6). The two compositions
 * are exclusive **by rule**, and the rule lives here rather than in an `&&` at
 * the call site so that nothing downstream can compose them by forgetting: a
 * page that collapsed to "a quiet day at the dock" would be answering a
 * question the owner never asked, over the three steps that are the whole
 * screen.
 */
export function spineIsQuiet(
  spine: DaySpine,
  deskPresenceRow: boolean,
  dayDepartures: number,
  firstRun = false,
): boolean {
  return (
    !firstRun &&
    spine.stations.length === 0 &&
    dayDepartures === 0 &&
    spineJobCount(spine) === 0 &&
    !deskPresenceRow
  );
}

/**
 * Has the day earned its morning all-clear line (principles.md §3, and the
 * coral budget's "The home, morning" row in ADR
 * 20260827-clearwater-surface-language)?
 *
 * Restated in spine terms: no danger or warning row on any of today's stations
 * or in the desk group. Tomorrow's and the week's jobs may remain — the line is
 * about *today's boats*, and a job three days out was never what it counted.
 *
 * Two conditions ride with it, both carried over from the line's first
 * implementation rather than invented here. A day with **no departures** never
 * earns it: "today's boats are all clear" over an empty dock is a compliment
 * about nothing. And a queue with **no work left anywhere** does not either —
 * that is the other good-news moment, the queue's own "Nothing is waiting on
 * you", and the two have never both rendered at once.
 */
export function todaysBoatsAreClear(spine: DaySpine): boolean {
  if (spine.stations.length === 0) return false;
  if (spineJobCount(spine) === 0) return false;
  const pressing = (action: TodayAction) => toneRank(action) < TONE_RANK.neutral;
  if (spine.desk.some(pressing)) return false;
  return !spine.stations.some((station) => station.rows.some(pressing));
}
