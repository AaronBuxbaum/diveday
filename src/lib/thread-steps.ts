import { hasReturned } from "@/lib/trips";
import { calendarDateInTimezone } from "./calendar-date";
import { nowDate } from "./clock";
import type { ChecklistState, DiverChecklistItem } from "./readiness-summary";
import { RECAP_AUTOMATIC_DELAY_MS } from "./recap-schedule";

/**
 * **The diver's thread as a spine of steps** — ADR 20260827-the-divers-thread,
 * decision 3, slice 7c.
 *
 * `readiness-summary.ts` turns the readiness engine's blockers into a diver's
 * checklist; this turns that checklist into the *order a diver walks*. The
 * difference is not cosmetic. A checklist is a set of categories that happen
 * to exist; a spine is a fixed sequence — sign → certification → pay → gear →
 * day-of — with one figure over it that says how far along it the diver is,
 * and that figure is the whole reason this module exists.
 *
 * **The figure must always be able to fill.** The page it replaced counted
 * `items.length + 2` and showed a wave-filled bar whose own copy admitted it
 * could never reach the end: the note, the support-needs question and the
 * hotel pickup were rendered as rows a diver could answer, left out of the
 * count, and three of the seven rows on screen therefore moved nothing when
 * answered. So every step this module emits is countable and every one of them
 * is finishable — the optional questions fold into Day-of details, which
 * settles on the one question that is genuinely asked of everybody (when did
 * you last dive), and the rest ride inside it without gating it.
 *
 * It decides nothing about readiness and re-voices nothing: the states come
 * straight off the checklist the engine already produced, and the two steps
 * that carry no blocker at all (gear, day-of) are booleans the caller
 * computes. Framework-free, no words — the caller resolves every id through
 * `src/i18n/thread-labels.ts`, per the repo's codes-not-sentences rule.
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
 * Three states, not four.
 *
 * The SPEC proposed a fourth, `upcoming`, "reserved for steps with nothing
 * actionable yet" — and nothing in this product produces one. Every step is
 * either finished, the diver's to do, or the shop's to finish; gear and
 * day-of are answerable from the moment the booking exists, and a waiver the
 * shop has not issued is the shop's (`waiver_not_sent` is a `waiting`
 * blocker), not a future the diver waits for. The quiet, dimmed reading the
 * artboard gives a later step is carried by `current` instead — the first
 * `your_turn` step is open, the rest are closed lines — which is a rendering
 * decision rather than a state, and leaves no branch here that no test can
 * reach.
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
   * The recency question is answered. Pickup, the note and support needs live
   * inside this step and never gate it: most divers have nothing to say to any
   * of the three, and a step that could not settle without them is the bar
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
  if (waiver) steps.push({ id: "sign", state: STATE_FROM_CHECKLIST[waiver.state], item: waiver });

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

  // **One slot, filled two ways** (ADR 20260904-reef-all-the-way-down, D15
  // with D19 folded in). A diver whose sizes the shop was already holding has
  // answered the gear question, so a settled "Gear and sizes" row beside a
  // live "Anything changed?" would be two rows for one fact — the duplication
  // decision 3 exists to end. A returning diver is asked once; a first-timer's
  // spine is what it always was; neither ever sees both.
  //
  // `changes` is countable and finishable like every other step, which is what
  // keeps the figure over the spine able to fill. The ThreadPhone artboard
  // draws "3 of 4 done" over five rows, which would need the fourth `upcoming`
  // state this module refused above; the ADR is what code obeys ("the thread
  // gains one step"), so the shipped figure counts five.
  if (input.carriedFacts) {
    steps.push({ id: "changes", state: input.carriedFactsConfirmed ? "done" : "your_turn" });
  } else {
    steps.push({ id: "gear", state: input.rentalFitComplete ? "done" : "your_turn" });
  }
  steps.push({ id: "dayof", state: input.dayOfComplete ? "done" : "your_turn" });

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
 * **The diver dived**, which is the condition that turns the thread page from
 * its prep state into its after-state (ADR 20260827-the-divers-thread,
 * decision 4, slice 7d).
 *
 * It opened on the clock alone until a review caught it (2026-08-28): the
 * one-hour late-arrival buffer above, and nothing else. That buffer is the
 * right rule for *has it sailed* and the wrong one for *did this person dive*,
 * because the only thing standing between a diver who never boarded and a page
 * saying "Welcome back" was `bookings.status = 'no_show'` — a staff act
 * performed during close-out, which is an evening ritual and "a recorded act,
 * never a gate" (docs/product/glossary.md). An hour after the boat tied up it
 * has almost never happened yet. So the diver who overslept, or who was held at
 * the desk on a medical hold and never left the dock, opened the durable link
 * already sitting in their inbox and got a printable dive record for a day they
 * spent on land, and an invitation to tip the crew who dived without them.
 *
 * Three answers, in the order the evidence deserves:
 *
 * - **`not_boarded` never sees the afterglow.** The crew wrote down that this
 *   person did not get on the boat; no clock overrides that.
 * - **`boarded` opens it at the buffer**, because the shop has recorded that
 *   they were aboard — the clock is no longer asserting anything on its own.
 * - **No roll call at all waits for the recap floor**
 *   (`RECAP_AUTOMATIC_DELAY_HOURS`, four hours). It is the delay the recap
 *   *send* has always used before it asserts the same thing by email, and a
 *   shop that does not run roll call should not have a second, looser rule
 *   invented for it here.
 *
 * Still deliberately blind to cancellation — of the booking or of the departure
 * — which are terminal notices the page decides before it ever asks this.
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
