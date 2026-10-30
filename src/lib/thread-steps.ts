import { isDiver, type ParticipantType, rentsGear } from "@/lib/participant-types";
import { hasReturned } from "@/lib/trips";
import { calendarDateInTimezone } from "./calendar-date";
import { nowDate } from "./clock";
import type { ChecklistState, DiverChecklistItem } from "./readiness-summary";
import { RECAP_AUTOMATIC_DELAY_MS } from "./recap-schedule";

/**
 * Builds the diver's fixed sequence: sign → certification → pay → gear or
 * changes → day-of. Every step counts toward progress and can settle. Optional
 * pickup and note answers stay inside Day-of details and do not gate it.
 * Readiness-owned states pass through unchanged; gear and day-of use caller
 * booleans. The caller resolves these ids through `src/i18n/thread-labels.ts`.
 */

/**
 * The fixed order a diver walks. Never re-ordered per booking.
 *
 * `gear` and `changes` are one slot filled two ways — see
 * {@link buildThreadSteps}. Both are listed because this tuple is a
 * *vocabulary* as well as a sequence: `THREAD_STEP_TITLE_KEYS` is a `Record`
 * over it, so a step with no word of its own is a compile error.
 */
export const THREAD_STEP_ORDER = [
  "sign",
  "certification",
  "pay",
  "gear",
  "changes",
  "dayof",
] as const;

export type ThreadStepId = (typeof THREAD_STEP_ORDER)[number];

/**
 * A step is done, the diver's turn, or the shop's turn. Later steps need no
 * fourth state: `current` identifies the first diver-owned step and rendering
 * can show subsequent steps as closed without changing their state.
 */
export type ThreadStepState = "done" | "your_turn" | "with_shop";

export type ThreadStep = {
  id: ThreadStepId;
  state: ThreadStepState;
  /**
   * The checklist item this step re-voices, for the three steps the readiness
   * engine owns. Absent on `gear`, `changes` and `dayof`, which no blocker produces — the
   * caller's own booleans decide those, and it is deliberate that they are
   * booleans: a rental fit reserves nothing and a recency answer gates nobody
   * (docs/product/glossary.md), so neither may ever become a blocker.
   */
  item?: DiverChecklistItem;
};

export type ThreadSpine = {
  /** In `THREAD_STEP_ORDER`, filtered to the ones this booking actually has. */
  steps: ThreadStep[];
  /** How many have settled. */
  done: number;
  /** How many there are — every emitted step counts, so `done` can reach it. */
  countable: number;
  /** The first step that is the diver's to do: the one open at rest. Null when nothing is. */
  current: ThreadStepId | null;
  /**
   * The checklist collapsed to its single setup item, so there is no spine to
   * render at all. The page shows this item's own reassuring line instead of a
   * figure and a list — never the generic one when the engine had something
   * more specific to say (`under_minimum_age` carries H-22's wording, which a
   * collapse to `setup_generic` would throw away).
   */
  setupItem?: DiverChecklistItem;
};

/** The engine's three states, in the thread's vocabulary. */
const STATE_FROM_CHECKLIST: Record<ChecklistState, ThreadStepState> = {
  done: "done",
  action: "your_turn",
  waiting: "with_shop",
};

export type ThreadStepsInput = {
  /** `buildDiverChecklist`'s output for this booking, unchanged. */
  checklist: readonly DiverChecklistItem[];
  /**
   * This booking carries an order — money is owed, or money has settled.
   * False on a departure that never asked for payment, which then renders no
   * Pay step rather than a settled one nobody paid.
   */
  hasPayableOrder: boolean;
  /**
   * `fitStatedAt != null` — the diver has answered the gear question, whatever
   * they answered. "Bringing my own" is a complete answer.
   */
  rentalFitComplete: boolean;
  /**
   * The recency question is answered. Pickup and the note live inside this
   * step and never gate it: most divers have nothing to say to either, and a
   * step that could not settle without them is the bar
   * that could never fill, rebuilt one level down.
   */
  dayOfComplete: boolean;
  /**
   * **The shop already held this diver's stated fit before this booking
   * existed** — `rental_fit_profiles.fit_stated_at` predates
   * `bookings.created_at`. A returning diver, in the only sense the data can
   * actually prove.
   *
   * The narrow test is deliberate. "Has a fit at all" would turn true the
   * instant a first-timer saved their sizes, and the step would then appear
   * mid-thread asking whether the thing they had just typed had changed.
   */
  carriedFacts: boolean;
  /**
   * They have answered the question for this seat
   * (`bookings.carried_facts_confirmed_at`) — by saying nothing changed, or by
   * changing one of the facts it covers.
   */
  carriedFactsConfirmed: boolean;
  /**
   * What the seat is (ADR 20261007-participant-types); absent means diver. A
   * rider rents nothing, so has no gear step; a seat that is not diving is
   * asked nothing that day-of settles on, so its day-of step is already done
   * and holds only the optional pickup, note and help questions.
   */
  participantType?: ParticipantType;
  /**
   * The enrollment still owes a course form (ADR 20261008-course-forms). With
   * `COURSE_FORMS_BLOCK_BOARDING` at warn-only no blocker says so, and a sign
   * step read off the release alone would say done beside a door asking for a
   * signature (issue #2266). Owed, the step stays the diver's turn.
   */
  courseFormsOwed?: boolean;
};

export function buildThreadSteps(input: ThreadStepsInput): ThreadSpine {
  const setupItem = input.checklist.find((item) => item.category === "setup");
  if (setupItem) {
    return { steps: [], done: 0, countable: 0, current: null, setupItem };
  }

  const byCategory = new Map(input.checklist.map((item) => [item.category, item]));
  const steps: ThreadStep[] = [];

  // Sign, when the departure has a waiver at all. `trip_requirements.
  // requires_waiver` defaults true and a blocker forces the category in as
  // well, so this is every ordinary departure — but a shop that switches
  // waivers off gets a two-step thread rather than a phantom "Sign" that is
  // either a lie when marked done or a permanent hole in the figure when not.
  const waiver = byCategory.get("waiver");
  if (waiver) {
    const state = STATE_FROM_CHECKLIST[waiver.state];
    steps.push({
      id: "sign",
      state: state === "done" && input.courseFormsOwed ? "your_turn" : state,
      item: waiver,
    });
  }

  // Certification, only where the engine emitted the category — it does so
  // when the trip gates on a card or when a blocker exists, which is already
  // the honest test.
  const certification = byCategory.get("certification");
  if (certification) {
    steps.push({
      id: "certification",
      state: STATE_FROM_CHECKLIST[certification.state],
      item: certification,
    });
  }

  // Pay, only on a booking that carries an order. A settled payment with no
  // checklist item behind it (the shop asked for money at booking and the
  // trip's own requirement does not gate on payment) still earns the step —
  // otherwise the money a diver just handed over would render nowhere.
  const payment = byCategory.get("payment");
  if (payment) {
    steps.push({ id: "pay", state: STATE_FROM_CHECKLIST[payment.state], item: payment });
  } else if (input.hasPayableOrder) {
    steps.push({ id: "pay", state: "done" });
  }

  // Returning divers confirm carried fit facts in one `changes` step; first
  // timers answer in one `gear` step. Never show both for the same booking.
  // A rider stays aboard: no sizes to give, and nothing carried to confirm.
  if (rentsGear(input.participantType) && input.carriedFacts) {
    steps.push({ id: "changes", state: input.carriedFactsConfirmed ? "done" : "your_turn" });
  } else if (rentsGear(input.participantType)) {
    steps.push({ id: "gear", state: input.rentalFitComplete ? "done" : "your_turn" });
  }
  const dayOfSettled = input.dayOfComplete || !isDiver(input.participantType ?? "diver");
  steps.push({ id: "dayof", state: dayOfSettled ? "done" : "your_turn" });

  return {
    steps,
    done: steps.filter((step) => step.state === "done").length,
    countable: steps.length,
    current: steps.find((step) => step.state === "your_turn")?.id ?? null,
  };
}

/**
 * **"Everyone's set — see you at the dock."**
 *
 * The party lead booked and paid for these seats and is the person who will
 * notice one is not ready, so the two facts here are theirs: every seat
 * claimed, every seat's waiver signed, plus their own signing step. Never full
 * per-member readiness — a card sitting with the shop for verification is the
 * shop's move, not the party's, and a running commentary on another diver's
 * paperwork is not something one diver's bearer link may hand over.
 *
 * Three refusals, each a rule rather than a nicety:
 *
 * - **Never for a party of one.** There is no "everyone" to be set.
 * - **Never while anything is outstanding**, which is what makes it worth
 *   reading at all.
 * - **Never once the boat sails today.** By then it is yesterday's news, and
 *   the dock call is not — so it yields rather than competing.
 */
export function partyIsAllSet(input: {
  /** Every seat this booking leads, excluding the lead's own. */
  seats: readonly { claimed: boolean; waiverSigned: boolean }[];
  /** The reader's own Sign step has settled — or the departure asks for no waiver. */
  ownSignSettled: boolean;
  /** The departure is today (see {@link isDiveDay}). */
  diveDay: boolean;
}): boolean {
  if (input.diveDay || input.seats.length === 0) return false;
  return input.ownSignSettled && input.seats.every((seat) => seat.claimed && seat.waiverSigned);
}

/**
 * The departure is today, in the shop's own zone, and has not sailed away from
 * the diver reading this.
 *
 * A calendar-date comparison rather than a duration: "today's the day" turns
 * true at 00:00 shop time, not twenty-four hours before the departure, which
 * is when a diver packing the night before stops reading this page as a plan
 * and starts reading it as a morning. The end is a moment rather than a date —
 * the standing one-hour late-arrival buffer (AGENTS.md), so a boat that ran
 * long is still out.
 */
export function isDiveDay(input: {
  startsAt: Date;
  endsAt: Date;
  /** `shops.timezone` — the zone the shop's day is measured in. */
  timeZone: string;
  now?: Date;
}): boolean {
  const now = input.now ?? nowDate();
  if (theBoatIsHome({ endsAt: input.endsAt, now })) return false;
  return (
    calendarDateInTimezone(input.startsAt, input.timeZone) ===
    calendarDateInTimezone(now, input.timeZone)
  );
}

/**
 * **The boat is scheduled home**, allowing for the standing one-hour
 * late-arrival buffer (AGENTS.md).
 *
 * A moment rather than a calendar date, and the trip's *end* rather than its
 * start: a diver reading their page on the surface interval is still on their
 * day. This is the clock question and the whole of what a clock can answer —
 * "has the day finished", never "did this person dive it". {@link isDiveDay}
 * stops exactly here, and {@link isAfterTheDive} starts from here.
 */
export function theBoatIsHome(input: { endsAt: Date; now?: Date }): boolean {
  const now = input.now ?? nowDate();
  return hasReturned(input.endsAt, now);
}

/**
 * What the shop recorded at the dock for this booking — the newest
 * `roll_call_events` row at the `departure` checkpoint, or null where the crew
 * recorded nothing (`departureRollCallForBooking`, src/db/manifests.ts).
 */
export type DepartureRollCall = "boarded" | "not_boarded" | null;

/**
 * Whether the diver can see the after-dive page. The clock alone cannot prove
 * they boarded: `not_boarded` always stays in prep, while `boarded` opens once
 * the return buffer passes. Without roll call, wait for the same delay as the
 * automatic recap before asserting a dive. A no-show booking status is not
 * dock evidence; it may be discretionary, absent, or reversed after boarding.
 * Cancellation is handled upstream as a terminal state.
 */
export function isAfterTheDive(input: {
  endsAt: Date;
  /** The dock's own record, where a shop kept one. */
  boarded?: DepartureRollCall;
  now?: Date;
}): boolean {
  if (input.boarded === "not_boarded") return false;
  const now = input.now ?? nowDate();
  if (input.boarded === "boarded") return theBoatIsHome({ endsAt: input.endsAt, now });
  // diveday:allow-departure-offset: the recap's own delay, not the sailed/returned
  // question — a recap waits its scheduled hours after a boat this rule already
  // counts as home.
  return now.getTime() > input.endsAt.getTime() + RECAP_AUTOMATIC_DELAY_MS;
}
