import type { HandledHelpRequest } from "@/db/help-requests";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import {
  blockerItemText,
  blockerRowText,
  diverAlsoText,
  diverItemsText,
  emailDeliveryDetailText,
  emailResendActionText,
  nameListText,
  openTripActionText,
  owedRefundDetailText,
  owedRefundGroupDetailText,
  owedRefundGroupSubjectText,
  type WaiverBatchCode,
  waiverBatchLabelText,
} from "@/i18n/today-labels";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import type { Role } from "@/lib/authz";
import { BLOCKER_ACTIONS, blockerDestination, isWaiverCode, primaryBlocker } from "@/lib/blockers";
import { resolveCopy } from "@/lib/copy";
import type { DiveIntentCount } from "@/lib/dive-intent";
import { formatMoneyCents } from "@/lib/format";
import { cachedCollator } from "@/lib/intl-cache";
import type { CrewIncompleteReason } from "@/lib/manifests";
import type { ReadinessBlocker } from "@/lib/readiness";
import { ROLL_CALL_GAP_KINDS, type RollCallGapReason } from "@/lib/roll-call-gaps";
import type { SeasonStart } from "@/lib/season";
import { countsAsJob } from "@/lib/today-job";
import { KIND_AUDIENCE, KIND_SEVERITY, type TodayActionKind } from "@/lib/today-kinds";
import { type TodayUrgency, urgencyFor } from "@/lib/today-urgency";
import type { TripStageReading } from "@/lib/trip-stages";
import { hasReturned, hasSailed } from "@/lib/trips";
import type { WelcomeCue } from "@/lib/welcome-cue";

/**
 * The Today page is a work queue, not a dashboard. Everything on it is either
 * something staff can act on right now, or a timely fact that no other surface
 * makes obvious in one click. Counts that only describe the shop ("upcoming
 * trips", "open seats") belong on Schedule; navigation belongs in the nav.
 *
 * This module is the framework-free half: it turns source-of-truth evidence
 * into ranked, human-readable actions. It never queries; `src/features/today/today-reader.ts`
 * gathers the facts and calls in here.
 *
 * How far out the queue looks is *not* decided here: the horizon is shared with
 * Not ready and Check-in and lives in `src/lib/operational-window.ts`. The
 * urgency bands below slice that horizon into "how soon"; they never widen it.
 *
 * Words live in the message bundles, not here — `src/i18n/today-labels.ts`
 * maps every code this file produces to its staff-bundle key, and the
 * `src/app`/`src/components` caller does the `t()` call. The one exception is
 * `diverBlockerAction`/`oneRowPerDiver` below: they compose a single
 * rendered `TodayAction.detail`/`actionLabel` string, a field several other
 * call sites (`src/features/today/today-reader.ts`) also fill with a plain string, so it stays
 * `string` rather than forking into a second, code-carrying shape. Those two
 * take a `StaffTranslator`, defaulted to English, and resolve through the same
 * `src/i18n/today-labels.ts` helpers (`blockerRowText` for the blocker's own
 * words) rather than calling `t()` inline.
 */

/**
 * Filters the action queue for the viewer's roles, taking the union for multi-role staff.
 * Owners and managers see everything.
 *
 * **What is withheld is not counted** (third review, item 5). A captain's
 * Today used to open on "22 jobs for the front desk", a number about rows the
 * role cannot see or act on, 60px above the fold of rows it can ("1 more for
 * other boats and the desk"). Two desk numbers on one screen; the one that
 * stays is the one the reader can open.
 *
 * **No roles means no viewer, not an empty audience.** Every surface that
 * renders this queue passes `session.user.roles`, which `requireStaffSession`
 * guarantees is non-empty. A caller that passes nothing is reading the shop's
 * whole day rather than one person's screen, so nothing is withheld from it.
 */
export function filterActionsForRoles(
  actions: readonly TodayAction[],
  roles?: readonly Role[],
): TodayAction[] {
  if (!roles || roles.length === 0 || roles.includes("owner") || roles.includes("manager")) {
    return [...actions];
  }
  const roleSet = new Set(roles);
  return actions.filter((action) => {
    const audience = KIND_AUDIENCE[action.kind];
    return audience ? audience.some((r) => roleSet.has(r)) : true;
  });
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
  blocked_aboard: { tone: "danger" },
  medical_review: { tone: "danger" },
  medical_not_cleared: { tone: "danger" },
  readiness_unavailable: { tone: "danger" },
  identity: { tone: "danger" },
  certification: { tone: "warning" },
  requirements: { tone: "warning" },
  waiver: { tone: "warning" },
  instructor_missing: { tone: "warning" },
  // Same tone as instructor_missing, its fun-dive sibling: nobody is in the
  // water yet, but it is not paperwork either.
  uncrewed_departure: { tone: "warning" },
  uncrewed_course: { tone: "warning" },
  // Warning both: a clash is a roster that contradicts itself, not a person
  // somebody has said is missing — that is `roll_call_missing_crew`'s danger.
  boat_clash: { tone: "warning" },
  crew_clash: { tone: "warning" },
  crew_clash_sailed: { tone: "warning" },
  // Warning, as the staffing week draws it on the person's chip: informs,
  // never gates (ADR 20260902-crew-requests-and-blackouts).
  crew_away: { tone: "warning" },
  nitrox_gate: { tone: "warning" },
  high_wind_alert: { tone: "warning" },
  dive_prep: { tone: "neutral" },
  help_request: { tone: "neutral" },
  payment: { tone: "neutral" },
  email_delivery: { tone: "neutral" },
  seat_wanted: { tone: "neutral" },
  emergency_contact: { tone: "neutral" },
  // Neutral, not warning: the target binds nothing and this is advice, not a
  // problem (src/lib/divemaster-ratio.ts).
  crew_below_target: { tone: "neutral" },
  stuck_payment_operation: { tone: "warning" },
  failed_photo_deletion: { tone: "warning" },
  owed_refund: { tone: "warning" },
  payment_dispute: { tone: "warning" },
  payments_restricted: { tone: "warning" },
  reviews_pending: { tone: "neutral" },
  // Neutral: somebody is waiting on an answer, which is the day's work
  // rather than a thing that has gone wrong.
  unanswered_messages: { tone: "neutral" },
  // Warning, not danger: a unit that is late is a phone call, not a diver in
  // the water. Due-back-today and a bench clock are ordinary counter work.
  gear_overdue: { tone: "warning" },
  gear_due_back: { tone: "neutral" },
  gear_service_due: { tone: "neutral" },
  // Danger: the kit for the worst minutes of the day is missing or lapsing on
  // a boat that sails today. It gates nothing — roll call and boarding go on —
  // but it is the one boat row nobody should scroll past.
  boat_safety_kit: { tone: "danger" },
  // Neutral while a paper is only coming due; danger once it has run out
  // (H-20261015-lapsed-boat-papers-loud); warning once kit the boat is meant to carry has.
  boat_papers_due: { tone: "neutral" },
  boat_papers_lapsed: { tone: "danger" },
  boat_safety_expired: { tone: "warning" },
  // Warning: something on the boat is wrong, and it informs, never gates.
  boat_snag: { tone: "warning" },
  // Warning: an account of a bad day is unfinished, not a person in danger.
  incident_report_unfiled: { tone: "warning" },
  // Warning: the shop gave its word on a day and the day has gone. Ready and
  // not collected is the customer's errand, not the shop's failure.
  work_order_late: { tone: "warning" },
  work_order_uncollected: { tone: "neutral" },
  staff_credential_due: { tone: "warning" },
  // Neutral, not warning: the shop is trading on a derived default that is
  // probably right. It wants confirming, not alarming about.
  units_unconfirmed: { tone: "neutral" },
  // Warning: a crew may reach for the card in the worst minute and find it empty.
  emergency_card_blank: { tone: "warning" },
  // Neutral: a mask waiting for its owner is not a problem.
  lost_items_waiting: { tone: "neutral" },
  // Neutral: a question about a size is not a problem, and a warning-toned row
  // asking whether to keep a wetsuit size would read as gear trouble.
  rental_fit_confirm: { tone: "neutral" },
} as const satisfies Record<TodayActionKind, { tone: "danger" | "warning" | "neutral" }>;

/**
 * How urgent each gap is. The four after-dive kinds — divers' and crew's alike
 * — are pinned to the top band: there is no "before it sails" left to derive
 * from, and a person may be in the water. The dock-count kinds land in "before
 * today's boats": real work, not an emergency.
 *
 * A `stale` gap (one the shop never closed and can no longer settle on the
 * dock) drops a band rather than disappearing — see `ROLL_CALL_RESIDUE_MS` in
 * `src/features/today/today-reader.ts`. A signal that self-clears is not a signal. Crew gaps age
 * on exactly the same 48h dock-work / 30-day residue schedule divers' do; a
 * crew member is not less findable than a customer.
 */
export function rollCallGapUrgency(reason: RollCallGapReason, stale: boolean): TodayUrgency {
  if (reason === "departure_uncounted" || reason === "no_roll_call") return "now";
  return stale ? "soon" : "imminent";
}

/**
 * **Where a crew clash stands, for Today** (H-20260916-may-one-hull-carry, issues #1776 and #1814).
 *
 * Asked of the subject departure's own legs the clash falls on, not of the
 * departure: a three-day course clashing on its third morning has a clash to
 * fix on days one and two and a boat out with it on day three.
 *
 * - `"out"` — some clashing leg has left and is not home. "Left" is
 *   `hasSailed` (the buffered hour every "has the boat gone" question
 *   shares, `.claude/rules/domain.md`), or earlier when the crew have already
 *   recorded the departure roll call: their tap beats the clock, as in
 *   `tripPhaseOf`. The roll call is the departure's, so it only speaks for its
 *   first leg.
 * - `"ahead"` — no clashing leg is out, and one is still to sail.
 * - `null` — every clashing leg is home (`hasReturned`): permanent and
 *   unfixable, said nowhere.
 */
export type CrewClashPhase = "ahead" | "out";

export function crewClashPhase(input: {
  legs: readonly { startsAt: Date; endsAt: Date }[];
  /** The departure's own `startsAt`, which names its first leg. */
  departureStartsAt: Date;
  /** Somebody has been recorded at this departure's `departure` checkpoint. */
  departureRollCallRecorded: boolean;
  now: Date;
}): { phase: CrewClashPhase; leg: { startsAt: Date; endsAt: Date } } | null {
  const { legs, departureStartsAt, departureRollCallRecorded, now } = input;
  const live = legs.filter((leg) => !hasReturned(leg.endsAt, now));
  const left = (leg: { startsAt: Date }) =>
    hasSailed(leg.startsAt, now) ||
    (departureRollCallRecorded && leg.startsAt.getTime() === departureStartsAt.getTime());
  const out = live.find(left);
  if (out) return { phase: "out", leg: out };
  const ahead = live[0];
  return ahead ? { phase: "ahead", leg: ahead } : null;
}

export type TodayAction = {
  /** Stable across renders so the list can be diffed and tested. */
  id: string;
  kind: TodayActionKind;
  /** A bundle key when the usual kind label would misstate the cause. */
  kindLabelKey?: StaffMessageKey;
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
  /**
   * What is wrong, in staff language.
   *
   * **Empty when the subject already is the whole row.** The desk's two
   * counting rows — "3 messages are waiting on an answer", "1 review is
   * waiting on you" — carried a second sentence that taught the feature to
   * somebody who had already found it, and the surfaces render no separator
   * and no paragraph for an empty one.
   */
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
   * Present when the tap re-sends failed booking confirmations in place — one,
   * or every one a batched row stands for. `href` stays the row's real
   * destination (pre-hydration tap, middle-click, open-in-new-tab), the trip.
   */
  resend?: { bookingIds: string[] };
  /**
   * Present on a `seat_wanted` row: the diver who asked first plus the context
   * the one-tap offer needs for its composer fallback, so staff can offer the
   * seat straight from the queue instead of navigating to the trip. `href`
   * stays the row's real destination (pre-hydration tap, middle-click,
   * open-in-new-tab), the trip's `#who-wants-in` panel.
   */
  offer?: {
    tripId: string;
    interestId: string;
    personName: string;
    personEmail: string | null;
    offeredAt: Date | null;
    bookingPath: string;
    tripTitle: string;
    tripWhen: string;
  };
  /**
   * Present on a single-diver `payment` row (payment_due/payment_refunded).
   * `orderId`/`hostedInvoiceUrl` start unset here — this module has no DB
   * access — and `src/features/today/today-shop-rows.ts` fills them in only when that
   * booking was actually invoiced through Stripe and the invoice is still open. The
   * queue renders the inline "copy link"/"resend invoice" control only once
   * `orderId` is present; otherwise the row keeps its `href` fallback to the
   * roster (never a dead button). A collapsed multi-diver row has no single
   * booking to act on, so it never carries this.
   */
  payment?: { bookingId: string; orderId?: string; hostedInvoiceUrl?: string | null };
  /** A one-choice day-of request and its visible staff hand-off state. */
  helpRequest?: {
    requestId: string;
    revision: number;
    status: "requested" | "acknowledged";
    helperPersonId: string | null;
    helperPersonName: string | null;
    crew: readonly { personId: string; fullName: string }[];
    meetingInstructions: string | null;
  };
  /**
   * Present on the evening's rental-fit question (issue #1174, D14): the tap
   * writes the size onto the diver's fit in place rather than navigating.
   * `href` stays the row's real destination — the diver's record — so a
   * pre-hydration tap, a middle-click and an open-in-new-tab all still land
   * somewhere the staffer can finish the job by hand.
   *
   * The reservation is the whole payload. It carried the diver, the kind and
   * the size until a `security-reviewer` pass (issue #1453) read what that
   * meant on the wire: the control binds these into the action, so a bound
   * size is a size any staff role could post for any diver. The action
   * re-proves all three from the desk's own `fit_adjusted` return instead, and
   * the detail a staffer reads is already rendered into `detail` above.
   */
  rentalFit?: { reservationId: string };
  /**
   * A lone diver whose headline is a card still waiting for its check
   * (`certification_pending`): who, so the shop home can offer the agency check
   * from the row (H-20261008-cert-check-extension). `cards` is empty as the queue words the row and filled
   * by the read (`withAgencyChecks`, `src/features/today/today-reader.ts`); a row whose diver holds
   * no card the extension can check has none.
   */
  agencyCheck?: { personId: string; cards: readonly AgencyCheckableCard[] };
  /**
   * The staff member a staff row is about (`staff_credential_due`), so the crew
   * lens can keep a reader's own row open rather than fold it with the desk's.
   */
  staffPersonId?: string;
  /**
   * Who a `crew_away` row names: the week line counts these people, once each
   * however many departures they are away for (issue #2671), and the row
   * offers each a "working it anyway" (issue #2678).
   */
  crewAway?: { people: readonly { personId: string; fullName: string }[] };
  /**
   * **The diver a row is about, and the short name of each gap it says is
   * open for them** ("waiver", "emergency contact"), worst first. Set on every
   * row about one diver's own gap on one boat, so `oneRowPerDiver` can name
   * each diver once under their boat with every item open for them.
   */
  diver?: {
    personId: string;
    items: readonly string[];
    /** Raised from a readiness blocker: it leads a merged row and keeps its own fix and sentence. */
    readiness?: true;
  };
  /**
   * A row that acts on divers already named in rows of their own (the boat's
   * one-tap waiver send): it is not counted again as a job.
   */
  batch?: true;
  /**
   * A tone louder than the kind's own, when a merged diver row folds in a row
   * that was (`oneRowPerDiver`): a payment lead with an ungated nitrox request
   * reads as the warning the nitrox row was (#2549). Read through `rowTone`.
   */
  tone?: "danger" | "warning";
  /** The departure this hangs off; drives urgency and ordering. */
  dueAt: Date | null;
};

/**
 * **The headline for a diver who is already aboard, worst first by what it
 * means in the water** — not by how long the fix takes, which is the ashore
 * order above. Once the diver is on the boat an unsigned waiver is a missing
 * medical declaration, so it outranks a card that does not reach the site:
 * a crew told only "Not certified" plans a shallower dive for somebody who has
 * never answered a medical question (`dive-domain-expert`, 2026-10-05). The
 * same order the departure card's aboard line used (`aboardBlockerKind`,
 * `src/lib/readiness.ts`), with payment last.
 */
const ABOARD_HEADLINE_RANK: Partial<Record<TodayActionKind, number>> = {
  medical_review: 0,
  medical_not_cleared: 0,
  readiness_unavailable: 1,
  identity: 2,
  requirements: 3,
  waiver: 4,
  certification: 5,
  payment: 6,
};

export function aboardPrimaryBlocker(
  blockers: readonly ReadinessBlocker[],
): ReadinessBlocker | null {
  const rank = (blocker: ReadinessBlocker) =>
    ABOARD_HEADLINE_RANK[BLOCKER_ACTIONS[blocker.code].kind] ?? Number.MAX_SAFE_INTEGER;
  let best: ReadinessBlocker | null = null;
  for (const blocker of blockers) if (!best || rank(blocker) < rank(best)) best = blocker;
  return best;
}

/**
 * Which blocker a diver's row leads with, and whether it is an `Aboard` row.
 * **Money owed never makes one**: it is the one blocker that changes nothing
 * in the water, and a danger-toned row beside the missing-diver rows saying
 * "Payment due." is how the red rows become wallpaper (DOM-H3). That diver
 * keeps an ordinary payment row.
 */
function headlineFor(diver: {
  blockers: readonly ReadinessBlocker[];
  aboard?: boolean;
}): { blocker: ReadinessBlocker; aboard: boolean } | null {
  const blocker = diver.aboard
    ? aboardPrimaryBlocker(diver.blockers)
    : primaryBlocker(diver.blockers);
  if (!blocker) return null;
  return {
    blocker,
    aboard: Boolean(diver.aboard) && BLOCKER_ACTIONS[blocker.code].kind !== "payment",
  };
}

/**
 * Whether a blocked diver aboard a boat that is out keeps a `blocked_aboard`
 * row: any open blocker but money alone, which changes nothing in the water.
 * The nav badge counts exactly these divers (`blockedOnNextBoatDay`).
 */
export function isBlockedAboard(blockers: readonly ReadinessBlocker[]): boolean {
  return headlineFor({ blockers, aboard: true })?.aboard === true;
}

/** A diver's other blockers, the one that takes longest to clear first (`KIND_SEVERITY`). */
function worstFirst(blockers: readonly ReadinessBlocker[]): ReadinessBlocker[] {
  const rank = (blocker: ReadinessBlocker) => KIND_SEVERITY[BLOCKER_ACTIONS[blocker.code].kind];
  return [...blockers].sort((a, b) => rank(a) - rank(b));
}

export type DiverBlockerInput = {
  bookingId: string;
  personId: string;
  fullName: string;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  blockers: readonly ReadinessBlocker[];
  /**
   * Their departure result is `boarded`: the diver is on the boat with the
   * blocker still open. The row keeps its fix and takes the `blocked_aboard`
   * kind, which is what says so — the departure card used to carry that as a
   * sentence of its own, beside this row telling the same blocker as if the
   * diver were still on the dock.
   */
  aboard?: boolean;
};

/**
 * One action per blocked diver, pointed at the surface that clears the
 * headline blocker, in a few words (`blockerRowText`). The full sentence and
 * every other blocker the diver owes are one tap away on the record.
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
  const headline = headlineFor(input);
  if (!headline) return null;
  const destination = blockerDestination([headline.blocker], {
    shopSlug,
    tripId: input.tripId,
    personId: input.personId,
    bookingId: input.bookingId,
    fullName: input.fullName,
  });
  if (!destination) return null;
  const { blocker, kind, sendsWaiver } = destination;
  return {
    id: `blocker:${input.bookingId}:${blocker.code}`,
    kind: headline.aboard ? "blocked_aboard" : kind,
    urgency: urgencyFor(input.startsAt, now),
    subject: input.fullName,
    context: input.tripTitle,
    departure: { tripId: input.tripId, label: input.tripTitle },
    detail: blockerRowText(t, blocker),
    actionLabel: resolveCopy(t, destination.label),
    href: destination.href,
    ...(sendsWaiver ? { waiver: { bookingIds: [input.bookingId] } } : {}),
    ...(kind === "payment" ? { payment: { bookingId: input.bookingId } } : {}),
    // Every blocker the diver owes, the headline first, so the one row that
    // names them under their boat can say all of it (`oneRowPerDiver`).
    diver: {
      personId: input.personId,
      items: [blocker, ...worstFirst(input.blockers.filter((each) => each !== blocker))].map(
        (each) => blockerItemText(t, each),
      ),
      readiness: true,
    },
    // Never on a held seat (H-20260724-one-person-per-email): the human on this booking may not be the
    // one whose cards are on file, so nobody checks that person's card from
    // here until a staffer confirms who it is. Said outright, not left to
    // which blocker heads the row.
    ...(blocker.code === "certification_pending" &&
    !input.blockers.some((each) => each.code === "identity_unconfirmed")
      ? { agencyCheck: { personId: input.personId, cards: [] } }
      : {}),
    dueAt: input.startsAt,
  };
}

/**
 * **Every blocked diver is a row of their own** (UX delight sheet 2026-10-22,
 * item 4, Aaron's call 4). The queue used to fold a boat's divers with the
 * same headline blocker into one counted row ("3 waivers not signed"), so the
 * desk tapped through to the roster to find out who. Now each blocked diver
 * is named; `oneRowPerDiver` then folds a diver's other gaps on the same boat
 * into that one row, and the boat's group caps a long list behind
 * "and N more" (`NeedsYouGroups`), so a busy boat still cannot bury the rest.
 *
 * Readiness is a safety surface: this drops nobody. Every diver with an open
 * blocker yields exactly one row, and a diver with none yields nothing.
 */
export function blockedDiverActions(
  divers: readonly DiverBlockerInput[],
  shopSlug: string,
  now: Date,
  t: StaffTranslator = staffTranslator("en-US"),
): TodayAction[] {
  return divers.flatMap((diver) => diverBlockerAction(diver, shopSlug, now, t) ?? []);
}

/**
 * **One tap still sends a boat's waivers** (coordinator, 2026-10-22): the
 * divers stay named one row each, and when two or more ashore on one boat lead
 * with the same waiver gap, one row about the boat sends them all — "3 waivers
 * not signed, not sent yet · Send waivers" — the batch the counted rows used to
 * carry. Grouped by headline, as that batch was, so a held seat
 * (`identity_unconfirmed` leads) never gets a waiver from it. Aboard divers keep
 * their own rows: a send cannot reach somebody already on the boat.
 */
export function waiverBatchActions(
  divers: readonly DiverBlockerInput[],
  shopSlug: string,
  now: Date,
  t: StaffTranslator = staffTranslator("en-US"),
): TodayAction[] {
  const byTripAndCode = new Map<string, { code: WaiverBatchCode; rows: DiverBlockerInput[] }>();
  for (const diver of divers) {
    const headline = headlineFor(diver);
    if (!headline || headline.aboard || !isWaiverCode(headline.blocker.code)) continue;
    const key = `${diver.tripId}:${headline.blocker.code}`;
    const bucket = byTripAndCode.get(key);
    if (bucket) bucket.rows.push(diver);
    else byTripAndCode.set(key, { code: headline.blocker.code, rows: [diver] });
  }
  return [...byTripAndCode].flatMap(([key, { code, rows }]) => {
    const [first] = rows;
    if (!first || rows.length < 2) return [];
    return [
      {
        id: `waivers:${key}`,
        kind: "waiver" as const,
        urgency: urgencyFor(first.startsAt, now),
        // Built like the open-orders row: a row about the departure renders
        // its detail, never its subject (layer 3 auditor review, B1).
        subject: first.tripTitle,
        context: first.tripTitle,
        departure: { tripId: first.tripId, label: first.tripTitle },
        aboutDeparture: true,
        batch: true as const,
        detail: blockerRowText(t, { code }, rows.length),
        actionLabel: waiverBatchLabelText(t, code),
        href: `/shop/${shopSlug}/trips/${first.tripId}`,
        waiver: { bookingIds: rows.map((row) => row.bookingId) },
        dueAt: first.startsAt,
      },
    ];
  });
}

/**
 * **Needs you names each diver once per boat** (UX delight sheet 2026-10-22,
 * item 4). Every row about one diver's own gap on one boat (`diver` set) is
 * folded into one row: the most pressing of them, by the list's own order
 * (`sortStationRows`), keeps its kind, its fix and its door, and its detail
 * becomes every item open for that diver — "waiver, emergency contact". A
 * diver with one gap keeps the row they had, sentence and all.
 *
 * Grouped **by diver inside each boat** (Aaron's call 4): a diver on two boats
 * is a row under each, because the fix for one departure is not the other's.
 * Rows that cannot name a person (orders, open seats, crew) pass through.
 *
 * Runs after `filterActionsForRoles`, so a row names only the items its reader
 * may see. The merged row sits where the diver's first row stood.
 */
export function oneRowPerDiver(
  actions: readonly TodayAction[],
  t: StaffTranslator = staffTranslator("en-US"),
): TodayAction[] {
  const keyOf = (action: TodayAction) =>
    action.diver && action.departure ? `${action.departure.tripId}:${action.diver.personId}` : null;
  const byDiver = new Map<string, TodayAction[]>();
  for (const action of actions) {
    const key = keyOf(action);
    if (key === null) continue;
    const rows = byDiver.get(key);
    if (rows) rows.push(action);
    else byDiver.set(key, [action]);
  }
  const out: TodayAction[] = [];
  for (const action of actions) {
    const key = keyOf(action);
    if (key === null) {
      out.push(action);
      continue;
    }
    const rows = byDiver.get(key);
    // The group is written where its first row stood, then forgotten.
    if (!rows) continue;
    byDiver.delete(key);
    out.push(diverRow(rows, t));
  }
  return out;
}

/**
 * One diver's rows on one boat as the one row that names every item.
 *
 * **A readiness blocker leads** whatever the list's rank says (layer 3 desk
 * review, B1): a payment blocker under a rental size lost its invoice control
 * and its door. And **it keeps its own sentence**, the other gaps after it
 * (auditor review, B2): "Not cleared to dive by a physician; also waiver" —
 * never a list of topics that reads a physician's no as paperwork. A row of
 * boat work alone says its items: "rental size, emergency contact".
 */
function diverRow(rows: readonly TodayAction[], t: StaffTranslator): TodayAction {
  const sorted = sortStationRows(rows);
  const lead = sorted.find((row) => row.diver?.readiness) ?? sorted[0];
  if (!lead?.diver) throw new Error("diverRow takes rows about one diver");
  const items = [
    ...new Set(
      [lead, ...sorted.filter((row) => row !== lead)].flatMap((row) => row.diver?.items ?? []),
    ),
  ];
  // The row is as loud as the loudest row it stands for.
  const loudest = sorted.reduce((worst, row) => (toneRank(row) < toneRank(worst) ? row : worst));
  const loudestTone = rowTone(loudest);
  const louder =
    toneRank(loudest) < toneRank(lead) && loudestTone !== "neutral" ? { tone: loudestTone } : {};
  if (items.length <= 1) return { ...lead, ...louder };
  const diver = { ...lead.diver, items };
  if (!lead.diver.readiness) return { ...lead, ...louder, detail: diverItemsText(items), diver };
  return {
    ...lead,
    ...louder,
    detail: diverAlsoText(t, lead.detail, items.slice(1)),
    diver,
  };
}

/** One email that never reached a diver, with the departure it was about. */
export type EmailDeliveryIssueInput = {
  deliveryId: string;
  bookingId: string;
  personId?: string;
  fullName: string;
  isWaiver: boolean;
  status: "sent" | "failed" | "not_configured";
  trip: { id: string; startsAt: Date; label: string };
};

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * **Emails that failed for several people are one row** (Aaron, 2026-10-05).
 * Batched by what was sent and why it did not arrive — a waiver link and a
 * confirmation resend through different paths, and an unconfigured sender is
 * a different fix from a bounce — across the whole window, so one bad morning
 * of mail is one job, not a screen of identical rows.
 *
 * A lone email keeps its diver's name as the subject. A batch says the count
 * as its whole sentence, resends every one of them in one tap, and names its
 * boat only when it has a single one.
 */
export function collapseEmailDeliveries(
  issues: readonly EmailDeliveryIssueInput[],
  shopSlug: string,
  now: Date,
  t: StaffTranslator = staffTranslator("en-US"),
): TodayAction[] {
  const batches = new Map<string, EmailDeliveryIssueInput[]>();
  for (const issue of issues) {
    const key = `${issue.isWaiver ? "waiver" : "confirmation"}:${issue.status}`;
    const batch = batches.get(key);
    if (batch) batch.push(issue);
    else batches.set(key, [issue]);
  }

  const actions: TodayAction[] = [];
  for (const [key, batch] of batches) {
    // Departure, then its label, then the ids, so a batch over two boats at the
    // same minute points at the same one whatever order it arrived in (issue
    // #2176). Code-unit comparison: the key is a tiebreak, not a reading order.
    const sorted = [...batch].sort(
      (a, b) =>
        a.trip.startsAt.getTime() - b.trip.startsAt.getTime() ||
        compareCodeUnits(a.trip.label, b.trip.label) ||
        compareCodeUnits(a.trip.id, b.trip.id) ||
        compareCodeUnits(a.bookingId, b.bookingId),
    );
    const first = sorted[0];
    if (!first) continue;
    const { isWaiver, status } = first;
    const bookingIds = sorted.map((issue) => issue.bookingId);
    const tripIds = new Set(sorted.map((issue) => issue.trip.id));
    const departure =
      tripIds.size === 1 ? { tripId: first.trip.id, label: first.trip.label } : undefined;
    const grouped = sorted.length > 1;
    actions.push({
      id: grouped ? `emails:${key}` : `email:${first.deliveryId}`,
      kind: "email_delivery",
      urgency: urgencyFor(first.trip.startsAt, now),
      subject: grouped
        ? emailDeliveryDetailText(t, isWaiver, status, sorted.length)
        : first.fullName,
      context: departure?.label ?? null,
      ...(departure ? { departure } : {}),
      detail: grouped ? "" : emailDeliveryDetailText(t, isWaiver, status, 1),
      // One tap resends in place. A waiver reuses the WP-1 issue-and-deliver
      // path (a fresh link, since the token is never stored); a confirmation
      // retries from the stored booking. `href` stays the row's real
      // destination — the roster row, or the trip, or for a batch over several
      // boats the earliest one's roster.
      actionLabel: emailResendActionText(t, isWaiver, grouped),
      ...(isWaiver ? { waiver: { bookingIds } } : { resend: { bookingIds } }),
      href: grouped
        ? `/shop/${shopSlug}/trips/${first.trip.id}`
        : first.personId
          ? `/shop/${shopSlug}/divers/${first.personId}`
          : `/shop/${shopSlug}/trips/${first.trip.id}#booking-${first.bookingId}`,
      dueAt: first.trip.startsAt,
    });
  }
  return actions;
}

/** One diver owed money for a departure the shop cancelled. Dates already formatted by the caller. */
export type OwedRefundInput = {
  bookingId: string;
  diverName: string;
  tripId: string;
  tripTitle: string;
  /** The departure’s date, formatted in the shop’s own zone by the caller. */
  when: string;
  amountCents: number | null;
  currency: string;
};

/**
 * **Five refunds owed on one cancelled boat is one job, not five.**
 *
 * The folding the queue once applied to blocked divers, applied
 * to the money a cancelled departure owes: a shop that pulls a charter off the
 * board owes every seat on it, so the queue drew one row per diver and each one
 * repeated "You cancelled the departure and the money couldn’t go back by
 * card" — one fact at equal weight, five times (principle 9, and the
 * cross-out test it ends on).
 *
 * A lone owed seat keeps the row it always had, down to its `owed-refund:<id>`
 * and the diver as its subject: a named person is more useful than "1 refund",
 * and there is nothing to say twice.
 *
 * The total is only stated when every seat in the group carries an amount **in
 * one currency**. A missing amount is a real state here — `owedRefundDetailText`
 * has a whole message for it — so summing around one would print a total that
 * is quietly short, which is the one thing a money figure may never be.
 */
export function collapseOwedRefunds(
  rows: readonly OwedRefundInput[],
  shopSlug: string,
  locale: string,
  t: StaffTranslator = staffTranslator("en-US"),
): TodayAction[] {
  const byTrip = new Map<string, OwedRefundInput[]>();
  for (const row of rows) {
    const bucket = byTrip.get(row.tripId);
    if (bucket) bucket.push(row);
    else byTrip.set(row.tripId, [row]);
  }

  const actions: TodayAction[] = [];
  for (const [tripId, seats] of byTrip) {
    const first = seats[0];
    if (!first) continue;
    const href = `/shop/${shopSlug}/trips/${tripId}`;
    if (seats.length === 1) {
      actions.push({
        id: `owed-refund:${first.bookingId}`,
        kind: "owed_refund",
        urgency: "now",
        subject: first.diverName,
        context: first.tripTitle,
        detail: owedRefundDetailText(t, {
          amount:
            first.amountCents === null
              ? null
              : formatMoneyCents(first.amountCents, first.currency, locale),
          tripTitle: first.tripTitle,
          when: first.when,
        }),
        // The departure it was cancelled from: where the seat is, and where
        // the payment gets marked refunded once the cash is back in a hand.
        actionLabel: openTripActionText(t),
        href,
        dueAt: null,
      });
      continue;
    }
    const currency = first.currency;
    const total = seats.every((seat) => seat.amountCents !== null && seat.currency === currency)
      ? seats.reduce((sum, seat) => sum + (seat.amountCents ?? 0), 0)
      : null;
    const names = seats.map((seat) => seat.diverName).sort((a, b) => a.localeCompare(b));
    actions.push({
      id: `owed-refunds:${tripId}`,
      kind: "owed_refund",
      urgency: "now",
      subject: owedRefundGroupSubjectText(t, seats.length),
      context: first.tripTitle,
      detail: owedRefundGroupDetailText(t, {
        amount: total === null ? null : formatMoneyCents(total, currency, locale),
        tripTitle: first.tripTitle,
        when: first.when,
        names: nameListText(t, names, names.length),
      }),
      actionLabel: openTripActionText(t),
      href,
      dueAt: null,
    });
  }
  return actions;
}

export type RoleLens = "boat" | "sessions" | null;

/**
 * Which lens Today leads with for the signed-in staffer
 * (20260721-role-aware-landing). Owners and managers triage the whole shop, so
 * they get no lens; instructors lead with their sessions; assistant instructors,
 * divemasters and captains lead with their boat. Instructor wins for people
 * holding both, matching the demo switcher's precedence — an Assistant
 * Instructor is a certified assistant in the water, not the person whose
 * sessions these are (issue #1680).
 */
export function roleLensFor(roles: readonly Role[]): RoleLens {
  if (roles.includes("owner") || roles.includes("manager")) return null;
  if (roles.includes("instructor")) return "sessions";
  if (
    roles.includes("assistant_instructor") ||
    roles.includes("divemaster") ||
    roles.includes("captain")
  ) {
    return "boat";
  }
  return null;
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
 * (`src/features/today/today-reader.ts`) is still the one reader and `KIND_SEVERITY` is still the
 * one severity ranking; this decides only *where* each
 * row already produced renders. A `TodayAction` that names a `departure.tripId`
 * files under that trip's station; one that names none files under the desk.
 * A new query, a new blocker rule or a second urgency computation here would
 * be the failure this shape exists to prevent — two answers about one boat.
 *
 * The shapes are structural rather than imported from `src/features/today/today-reader.ts` for
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
  /** The course this session teaches, or null for a fun dive — the site mark reads it. */
  courseTitle: string | null;
  boatName: string | null;
  priceCents: number | null;
  /** The stated seats. */
  capacity: number;
  /** The seats on sale under the boat's certificate (`sellableSeats`); open seats count against it. */
  sellableCapacity: number;
  /** A practice departure (ADR 20261012-rehearsal-departures); the card says so (#2395). */
  rehearsal: boolean;
  booked: number;
  boarded: number;
  blocked: number;
  crew: readonly { fullName: string }[];
  /**
   * The crew half of the departure checkpoint — the one safety fact the card
   * still carries itself (issue #789). A blocked diver already aboard (issue
   * #791) is a `blocked_aboard` row in Needs you, where their fix is.
   */
  crewAccountedFor: boolean;
  crewReason: CrewIncompleteReason | null;
  /**
   * The crew's own word for where this boat is, and when they said it (ADR
   * 20260904-reef-all-the-way-down, Budget rule 4), read through
   * `boatStageOf` so the card's chip is the header's and the manifest's word.
   * Null on a departure whose crew has tapped nothing today, which renders
   * nothing — never "Unknown", and never a word the clock made up.
   */
  stage?: TripStageReading | null;
  /**
   * **What the divers aboard came for, as counts** (D12/#1172 with D23/#1183,
   * issue #1386). Empty on a departure nobody answered on, which is the
   * ordinary state and renders nothing at all.
   *
   * A fact the station carries, not a queue row: it names nobody, there is
   * nothing to tap, and D23's boundary is that it suggests a conversation and
   * never a pairing. Nothing about ranking or `assembleDaySpine` reads it.
   */
  intents?: readonly DiveIntentCount[];
  /**
   * **Who to say hello to** (issue #1182; fifth loop, item 10): today's divers
   * who shared that this is their first trip with the shop, or that they are
   * back after a long gap. A line on the card, never a Needs you row: a
   * greeting has no done state, so a row for it was a job nobody could finish.
   * Empty, the card says nothing.
   */
  welcome?: readonly { name: string; cue: WelcomeCue }[];
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
  /**
   * Rows with no station to hang on: those bound to no departure, those about
   * a boat that is out past the spine's window (`SpineWork.outTripIds`), and
   * every open after-dive head count whose boat has no station, whatever its
   * phase or day. All of them rank in Needs you.
   */
  desk: TodayAction[];
  /** The collapsed Tomorrow disclosure's body and count. */
  tomorrow: { stations: DayStation[]; jobs: number };
  /** The rest of the horizon: a count, and the rows behind it, opened in place. */
  week: { jobs: number; rows: TodayAction[] };
  /** Handled help requests on today's departures, each reopenable (issue #2939). */
  handledHelp: readonly HandledHelpRequest[];
};

/** Tone first: danger, then warning, then everything quiet. */
const TONE_RANK: Record<"danger" | "warning" | "neutral", number> = {
  danger: 0,
  warning: 1,
  neutral: 2,
};

/** A row's tone: its kind's, unless a merged row carries a louder one (`TodayAction.tone`). */
export function rowTone(action: TodayAction): "danger" | "warning" | "neutral" {
  return action.tone ?? ACTION_KIND_META[action.kind].tone;
}

function toneRank(action: TodayAction): number {
  return TONE_RANK[rowTone(action)];
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
    // Two rows alike in everything but their boat (two 2:30 PM departures each
    // short the same sizes) read in their boat's order, never in the order the
    // queue happened to build them (issue #2788).
    return (
      CLOCK_COLLATOR.compare(a.subject, b.subject) ||
      CLOCK_COLLATOR.compare(a.departure?.label ?? "", b.departure?.label ?? "") ||
      CLOCK_COLLATOR.compare(a.departure?.tripId ?? "", b.departure?.tripId ?? "") ||
      CLOCK_COLLATOR.compare(a.id, b.id)
    );
  });
}

/**
 * **Clock order for departures, total** (issue #2788): start minute, then title,
 * then boat name (when the caller can name it), then id. Two boats at the same minute read by title before id because ids
 * are minted fresh by every seed, so an id tiebreak alone swaps them from one
 * run to the next. Every "which of these comes first" on Today — the spine's
 * stations, and which of two clashing departures says the clash — reads this
 * one order, so the row and the station it files under always agree.
 */
export function departureClockOrder<T extends { startsAt: Date; title: string }>(
  idOf: (departure: T) => string,
  boatOf: (departure: T) => string | null | undefined = () => null,
): (a: T, b: T) => number {
  return (a, b) =>
    clockMinute(a.startsAt) - clockMinute(b.startsAt) ||
    CLOCK_COLLATOR.compare(a.title, b.title) ||
    CLOCK_COLLATOR.compare(boatOf(a) ?? "", boatOf(b) ?? "") ||
    CLOCK_COLLATOR.compare(idOf(a), idOf(b));
}

/**
 * The one collator every departure tiebreak reads, fixed to a locale so the
 * server and the spine agree whatever the runtime's default is (issue #2788).
 */
const CLOCK_COLLATOR = cachedCollator("en");

/** The clock minute a departure leaves in: "the 2:30 PM" is every boat inside it. */
const clockMinute = (at: Date): number => Math.floor(at.getTime() / 60_000);

/** What `assembleDaySpine` needs of one `getTodayWork` result. */
export type SpineWork = {
  departures: readonly SpineDeparture[];
  actions: readonly TodayAction[];
  /**
   * Departures that have started and are not home (`TodayWork.outTripIds`),
   * cancelled-after-boarding included. Every row about one of them that has no
   * station is today's work, not the week's: a blocked diver aboard or a crew
   * clash on a boat that sailed must not become a number behind a link to the
   * board (issues #2064, #1814). An after-dive head count that is still open
   * goes to Needs you whether or not its boat is listed here — a boat that is
   * already back, last night's included, is
   * {@link AFTER_DIVE_ROLL_CALL_KINDS}' case (issue #2131). Optional so a
   * hand-built spine in a test can leave it out.
   */
  outTripIds?: readonly string[];
  /** `TodayWork.handledHelp`; optional so a hand-built spine in a test can leave it out. */
  handledHelp?: readonly HandledHelpRequest[];
};

/**
 * The open after-dive head counts — somebody recorded not back, or somebody
 * who boarded with no result yet, diver or crew. A person may be in the water,
 * so with no live station to hang on they rank in Needs you whatever the
 * boat's phase or day, never in the week count (issue #2131). The dock-count
 * kinds (`roll_call_departure_open`, `roll_call_not_started`) are paperwork and
 * stay out: thirty days of them would bury the rows that matter.
 */
const AFTER_DIVE_ROLL_CALL_KINDS: ReadonlySet<TodayActionKind> = new Set([
  ROLL_CALL_GAP_KINDS.missing_diver,
  ROLL_CALL_GAP_KINDS.missing_crew,
  ROLL_CALL_GAP_KINDS.after_dive_uncounted,
  ROLL_CALL_GAP_KINDS.crew_uncounted,
]);

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
 * **A boat that is out but no longer a station still speaks at the desk.**
 * Stations come from a forward-looking reader, so a departure that left more
 * than an hour ago, or a multi-day course past its first morning, has none. A
 * row about one of those (`today.outTripIds`) files under the desk, where it
 * still names its own boat, rather than into the week's count behind a link:
 * a boat on the water with a question about who is aboard is today's work
 * (dive-domain-expert review of H-20260916-may-one-hull-carry, 2026-10-06).
 *
 * Stations arrive in clock order, and nothing re-orders them: the crew-first
 * ordering the departure board used is deliberately gone,
 * because a spine that puts 1:00 PM above 7:00 AM for one reader is no longer
 * a clock.
 */
export function assembleDaySpine(today: SpineWork, tomorrow: SpineWork): DaySpine {
  const byClock = departureClockOrder<SpineDeparture>(
    (departure) => departure.tripId,
    (departure) => departure.boatName,
  );
  const todayDepartures = [...today.departures].sort(byClock);
  const tomorrowDepartures = [...tomorrow.departures].sort(byClock);

  const stationed = new Set([
    ...todayDepartures.map((departure) => departure.tripId),
    ...tomorrowDepartures.map((departure) => departure.tripId),
  ]);
  const out = new Set(today.outTripIds ?? []);
  const rowsByTrip = new Map<string, TodayAction[]>();
  const desk: TodayAction[] = [];
  const liveTripIds = new Set(todayDepartures.map((departure) => departure.tripId));
  for (const action of today.actions) {
    if (
      !action.departure ||
      (out.has(action.departure.tripId) && !stationed.has(action.departure.tripId)) ||
      (!liveTripIds.has(action.departure.tripId) && AFTER_DIVE_ROLL_CALL_KINDS.has(action.kind))
    ) {
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

  const weekRows = today.actions.filter(
    (action) =>
      action.departure &&
      !stationed.has(action.departure.tripId) &&
      !out.has(action.departure.tripId) &&
      !AFTER_DIVE_ROLL_CALL_KINDS.has(action.kind),
  );

  return {
    stations,
    desk: sortStationRows(desk),
    tomorrow: {
      stations: tomorrowStations,
      jobs: tomorrowStations.reduce(
        (total, station) => total + station.rows.filter(countsAsJob).length,
        0,
      ),
    },
    week: { jobs: weekRows.filter(countsAsJob).length, rows: sortStationRows(weekRows) },
    handledHelp: today.handledHelp ?? [],
  };
}

/**
 * **Who is away this week, named on the week line** (issue #2671, decided by
 * Aaron 2026-10-17): the rostered crew the week's `crew_away` rows name, each
 * counted once. Every other later-day row stays a count: the page is about
 * today.
 */
export function weekCrewAway(rows: readonly TodayAction[]): number {
  const people = new Set<string>();
  for (const row of rows) {
    if (row.kind !== "crew_away" || !row.crewAway) continue;
    for (const person of row.crewAway.people) people.add(person.personId);
  }
  return people.size;
}

/** Every row the spine holds, wherever it filed. */
export function spineJobCount(spine: DaySpine): number {
  return (
    spine.stations.reduce((total, station) => total + station.rows.filter(countsAsJob).length, 0) +
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
 * Has the day earned its morning all-clear line (principles.md §3)?
 *
 * Restated in spine terms: no danger or warning row on any of today's stations
 * or in the desk group, **and nobody blocked on any of today's boats**. The
 * second clause is the role lens's honesty clause (UX review 2026-10-10, item
 * 2): a captain's lens withholds the desk's waiver row, and "Today's boats are
 * all clear" under a card saying "1 blocked" was the screen contradicting
 * itself. A blocked diver is a fact about the boat, whoever's job the fix is.
 * Tomorrow's and the week's jobs may remain — the line is about *today's
 * boats*.
 *
 * Two conditions ride with it. A day with **no departures** never earns it:
 * "today's boats are all clear" over an empty dock is a compliment about
 * nothing. And a queue with **no work left anywhere** does not either — that
 * is the other good-news moment, the queue's own "Nothing is waiting on you",
 * and the two have never both rendered at once.
 *
 * `blocked` is the figure the day's sentence says ("1 person blocked"), which
 * also counts a diver blocked aboard a boat that is out past its station.
 */
export function todaysBoatsAreClear(spine: DaySpine, blocked = 0): boolean {
  if (spine.stations.length === 0) return false;
  if (spineJobCount(spine) === 0) return false;
  if (blocked > 0) return false;
  if (spine.stations.some((station) => station.blocked > 0)) return false;
  const pressing = (action: TodayAction) => toneRank(action) < TONE_RANK.neutral;
  if (spine.desk.some(pressing)) return false;
  return !spine.stations.some((station) => station.rows.some(pressing));
}

/** Who is reading the Needs you list, and what stands in it beside the jobs. */
export type NeedsYouLens = {
  /**
   * Trips the reader crews — passed only under the boat lens. Their rows lead
   * and every other row folds, except a danger row and a row about the
   * reader themself.
   */
  crewedTripIds?: readonly string[];
  readerPersonId?: string;
  /** The reader's own fresh form drafts; each is one row of the list. */
  drafts?: number;
  /** The desk's presence-derived payments row is showing. */
  paymentsRow?: boolean;
  /** The day's sentence's blocked figure (`daySummaryBlocked`). */
  blocked?: number;
  now: Date;
};

/**
 * **What Needs you holds, read once for every role** (UX review 2026-10-10,
 * item 2).
 *
 * The page's sentence ("2 things need you before the 6:30 PM leaves the
 * dock"), the list's own count ("Needs you · 2 things") and the all-clear line
 * used to be three derivations: the sentence counted warning and danger rows
 * on the next boat across the whole shop, the list counted what the reader's
 * lens led with, and the line ignored who was blocked. On a captain's Today
 * that read "Nothing needs you before the 6:30 PM" over "Needs you · 2
 * things" for that boat, and "all clear" under "1 person blocked". Now all
 * three are this one reading, so they cannot disagree:
 *
 * - `lead` is the list the reader works; `folded` is the one line a crew
 *   reader can open for the desk's rows (null when nothing folds).
 * - `count` is the list's own number: the lead rows, the drafts, and the
 *   payments row when it is not folded.
 * - `next` is the next boat that has not sailed, and `dueBeforeNext` is how
 *   many of the lead rows are about it, or about any boat leaving at the same
 *   minute — the sentence's number. Once every
 *   boat is away the sentence says `count`.
 * - `boatsClear` is {@link todaysBoatsAreClear}.
 */
export type NeedsYouReading = {
  lead: TodayAction[];
  folded: TodayAction[] | null;
  count: number;
  next: DayStation | null;
  dueBeforeNext: number;
  boatsClear: boolean;
};

export function readNeedsYou(spine: DaySpine, lens: NeedsYouLens): NeedsYouReading {
  const crewed = new Set(lens.crewedTripIds ?? []);
  // **One "Needs you" list** (ADR 20261001-logbook, decision 4): every job on
  // today's boats and at the desk, ranked together.
  const all = sortStationRows([
    ...spine.stations.flatMap((station) => station.rows),
    ...spine.desk,
  ]);
  // **A crew reader's lens** (UX audit 2026-10-07, item 7): for a captain or
  // divemaster who crews one of today's boats, the list leads with that boat's
  // rows and every other row folds into one line. A danger row about any boat
  // never folds: a diver unaccounted for is everyone's to see. Nor does a row
  // about the reader themself, such as their own credential coming due.
  const crewsToday = spine.stations.some((station) => crewed.has(station.tripId));
  const leads = (action: TodayAction) =>
    !crewsToday ||
    rowTone(action) === "danger" ||
    (action.departure != null && crewed.has(action.departure.tripId)) ||
    (lens.readerPersonId != null && action.staffPersonId === lens.readerPersonId);
  const lead = all.filter(leads);
  const rest = all.filter((action) => !leads(action));
  const paymentsRows = lens.paymentsRow ? 1 : 0;
  const folded = crewsToday && (rest.length > 0 || paymentsRows > 0) ? rest : null;
  const count = lead.filter(countsAsJob).length + (lens.drafts ?? 0) + (folded ? 0 : paymentsRows);
  const next = spine.stations.find((station) => !hasSailed(station.startsAt, lens.now)) ?? null;
  // The sentence names a time, not a boat: every boat leaving at that minute
  // is "the 2:30 PM", so the count is theirs together and cannot change with
  // which of two same-minute boats sorted first (issue #2788).
  const nextTripIds = new Set(
    next
      ? spine.stations
          .filter((station) => clockMinute(station.startsAt) === clockMinute(next.startsAt))
          .map((station) => station.tripId)
      : [],
  );
  // The blank emergency reference counts too when it names that minute's boat:
  // it files under the desk, not the boat it would sail on (Aaron 2026-10-23).
  // Every other desk row is not about a boat.
  const dueBeforeNext = next
    ? lead.filter(
        (action) =>
          countsAsJob(action) &&
          (action.departure != null
            ? nextTripIds.has(action.departure.tripId)
            : action.kind === "emergency_card_blank" &&
              action.dueAt != null &&
              clockMinute(action.dueAt) === clockMinute(next.startsAt)),
      ).length
    : count;
  return {
    lead,
    folded,
    count,
    next,
    dueBeforeNext,
    boatsClear: todaysBoatsAreClear(spine, lens.blocked ?? 0),
  };
}

/**
 * **One fact of scale, on the day it is true** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 3.
 *
 * The narrower thing the standing good-news line was declined for being
 * (issue #808, still declined): not a line that is present always, but a fact
 * that is true once and then never again this season. Rule 3 bounds it to a
 * count of divers or boats — never money, a comparison, a streak or a rank —
 * and it renders **nothing** on every other day, which is most of them.
 *
 * The season's first boat outranks its hundredth diver when a day is both:
 * one of them happens once a season and the other happens five times.
 *
 * The hundredth diver is the seat that *crosses* the hundred, in boarding
 * order, so a day that crosses two hundreds says the first of them and never
 * the second. That is the same restraint the coral budget puts on every other
 * moment: one, or none.
 *
 * **Divers, not seats**, which is what issue #1373 asks for and what the
 * sentence means: a regular who dives every Saturday is one diver of the
 * season, not thirty. Only a person nobody has seen this season moves the
 * count, and only once, however many of today's boats they are on.
 */
export type FactOfScale =
  | { kind: "first_boat"; seasonStart: SeasonStart }
  | {
      kind: "divers";
      count: number;
      diverName: string;
      departureAt: Date;
      seasonStart: SeasonStart;
    };

export function factOfScaleFor(input: {
  seasonStart: SeasonStart;
  diversBefore: number;
  todaySeats: readonly {
    personId: string;
    diverName: string;
    departureAt: Date;
    seenEarlierThisSeason: boolean;
  }[];
  firstBoatOfSeason: boolean;
}): FactOfScale | null {
  if (input.firstBoatOfSeason) return { kind: "first_boat", seasonStart: input.seasonStart };
  // Divers, not seats. A regular who dives every Saturday is one diver, and a
  // diver on two of today's boats is still one — so a person already counted
  // this season, today included, moves the count no further.
  const countedToday = new Set<string>();
  let running = input.diversBefore;
  for (const seat of input.todaySeats) {
    if (seat.seenEarlierThisSeason || countedToday.has(seat.personId)) continue;
    countedToday.add(seat.personId);
    running += 1;
    if (running % FACT_OF_SCALE_EVERY !== 0) continue;
    return {
      kind: "divers",
      count: running,
      diverName: seat.diverName,
      departureAt: seat.departureAt,
      seasonStart: input.seasonStart,
    };
  }
  return null;
}

/** Every hundredth diver, which is the ADR's own number. */
const FACT_OF_SCALE_EVERY = 100;

/**
 * **Needs you, one heading per boat** (fifth loop, item 11). The list read
 * "3:00 PM · Two-Tank Reef" under each of seven rows; grouped, the boat is said
 * once and each row is its own sentence. Groups keep the ranked list's order:
 * a boat's group sits where its most pressing row stood, and the rows inside it
 * keep their rank. Rows bound to no departure follow every boat as the desk's
 * group (`departure: null`), whatever their rank, because they are not about a
 * boat leaving at a time.
 */
export type NeedsYouGroup = {
  departure: { tripId: string; label: string } | null;
  rows: TodayAction[];
};

export function groupByDeparture(rows: readonly TodayAction[]): NeedsYouGroup[] {
  const boats = new Map<string, NeedsYouGroup>();
  const desk: TodayAction[] = [];
  for (const row of rows) {
    if (!row.departure) {
      desk.push(row);
      continue;
    }
    const group = boats.get(row.departure.tripId);
    if (group) group.rows.push(row);
    else boats.set(row.departure.tripId, { departure: row.departure, rows: [row] });
  }
  const groups = [...boats.values()];
  return desk.length > 0 ? [...groups, { departure: null, rows: desk }] : groups;
}

/**
 * **A long boat stays readable at 390px** (UX delight sheet 2026-10-22, item
 * 4). Naming each diver turned "9 waivers not signed" into nine rows, so a
 * boat's group shows its first few and folds the rest behind "and N more",
 * which opens the full list in place. Nobody is dropped: `shown` and `more`
 * together are every row, in the ranked order.
 *
 * **A danger row or a readiness blocker never folds**: a diver not back
 * aboard, a medical hold or an unsigned waiver is everyone's to see, however
 * many there are. **Nor does a diver's own help request**: it is their ask,
 * waiting on a staffer to arrange help, and a neutral row ranks last, so a
 * fold would hide the one row a diver is waiting on. A list only one longer than the cap shows whole, because "and 1
 * more" costs the room of the row it hides (`nameListText`'s rule).
 * The rows that never fold count toward the five (visual review A43), so a
 * group shows five unless more than five can never fold.
 */
export const BOAT_ROWS_SHOWN = 5;

/** Every kind a readiness blocker raises, aboard or ashore: none of them folds. */
const READINESS_KINDS: ReadonlySet<TodayActionKind> = new Set([
  "blocked_aboard",
  ...Object.values(BLOCKER_ACTIONS).map((action) => action.kind),
]);

/**
 * A row raised by a readiness blocker. `payment` is also the boat's own
 * "orders awaiting payment" row, which gates nobody: only the diver's
 * unpaid-seat row (`diver.readiness`) counts, or the orders row would take a
 * seat among the five and fold a missing contact under it (A43, layer 6).
 */
function isReadinessRow(row: TodayAction): boolean {
  if (!READINESS_KINDS.has(row.kind)) return false;
  return row.kind !== "payment" || row.diver?.readiness === true;
}

export function foldBoatRows(rows: readonly TodayAction[]): {
  shown: TodayAction[];
  more: TodayAction[];
} {
  // Danger and readiness rows are kept wherever they sit: a fold that hid one
  // would be the grouping hiding a diver who cannot board (layer 3 auditor
  // review, note 1). A diver's help request is their ask, not a chore: it
  // keeps Arrange help in reach. Only boat work and the boat's other chores fold.
  const neverFolds = (row: TodayAction) =>
    rowTone(row) === "danger" || isReadinessRow(row) || row.kind === "help_request";
  // The rows that never fold take their seats among the five first, so the
  // group still shows five (A43) and folds more boat work instead, unless
  // more than five can never fold.
  let open = Math.max(0, BOAT_ROWS_SHOWN - rows.filter(neverFolds).length);
  const shown: TodayAction[] = [];
  const more: TodayAction[] = [];
  for (const row of rows) {
    if (neverFolds(row)) shown.push(row);
    else if (open > 0) {
      shown.push(row);
      open -= 1;
    } else more.push(row);
  }
  return more.length <= 1 ? { shown: [...rows], more: [] } : { shown, more };
}
