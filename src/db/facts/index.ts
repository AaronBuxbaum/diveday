import type { AppDb } from "@/db/client";
import { HOUR_MS } from "@/lib/clock";
import { addASiteItsStationIsNowhereNear } from "./add-a-site-its-station-is-nowhere-near";
import { answerTheNewestReview } from "./answer-the-newest-review";
import { askForAPieceTheShopNoLongerRents } from "./ask-for-a-piece-the-shop-no-longer-rents";
import { askForAnIntroSessionPastItsRatio } from "./ask-for-an-intro-session-past-its-ratio";
import { boardADiverThenBlockThem } from "./board-a-diver-then-block-them";
import { boardEveryDiverAndNoCrew } from "./board-every-diver-and-no-crew";
import { slideOneDepartureOntoAnotherHull } from "./boat-clash";
import { checkInADiverThenBlockThem, leaveASeatUncounted } from "./boat-states";
import { bounceThreeConfirmations } from "./bounce-three-confirmations";
import { cancelADepartureSomebodyPaidFor } from "./cancel-a-departure-somebody-paid-for";
import { carrySomebodyWhoIsNotDiving } from "./carry-somebody-who-is-not-diving";
import { countHeadsOnADepartureNobodyWillMove } from "./count-heads-on-a-departure-nobody-will-move";
import { flagFourUnitsOnTheReefBoat } from "./flag-four-units-on-the-reef-boat";
import {
  leaveTwoUnitsUncollected,
  lendAMaskToSomeoneWithNoWaiver,
  returnTheBenchedUnitWithAConcern,
} from "./gear-states";
import { hideEnoughReviewsToWithholdTheRating } from "./hide-enough-reviews-to-withhold-the-rating";
import { letTheReefBoatsKitLapse } from "./let-the-reef-boats-kit-lapse";
import { logPastSeasonsOfThisMonth } from "./log-past-seasons-of-this-month";
import { seedManifestOverCapacityState } from "./manifest-overcapacity-state";
import { markMixedWaiverDelivery } from "./mark-mixed-waiver-delivery";
import { mergeCandidatesState } from "./merge-candidates-state";
import { makeRoomForPartyWaiverCaptures } from "./party-waiver-capacity-state";
import { putARehearsalOnTomorrow } from "./put-a-rehearsal-on-tomorrow";
import { putOneUnitOutToday } from "./put-one-unit-out-today";
import { putTheBenchBehind } from "./put-the-bench-behind";
import { seedRentalLookupFleet } from "./rental-lookup-state";
import { sayPriyaIsRunningLate } from "./say-priya-is-running-late";
import { seatSomebodyOffTheNamePrompt } from "./seat-somebody-off-the-name-prompt";
import { seedOwedMoney } from "./seed-owed-money";
import { slideOneDepartureOntoAnother } from "./slide-one-departure-onto-another";
import {
  declareNoCard,
  leavePaymentUnconfirmed,
  oweStripeTwoErasures,
  refuseAPhotoDelete,
  runGearOverdue,
} from "./trouble-panels";
import { unsignTheSeededMinorsRelease } from "./unsign-the-seeded-minors-release";
import { unstaffTomorrowsDeparture } from "./unstaff-tomorrows-departure";

/**
 * **A test shop's state is a list of named facts** (issue #2759). One
 * vocabulary, each fact written through the product's writers where one exists,
 * so a fixture is a day the product could have produced; the test route
 * (`/api/test/seed-trouble-states`) is a thin applier of a list of them.
 *
 * What a fact is handed: the database, the demo shop's id and timezone, one of
 * the shop's own people (for the rows that name who acted) and the clock's
 * instant. What it returns is its answer to the capture that asked, keyed by the
 * fact's name; a fact with nothing to say returns nothing and is omitted.
 *
 * **Order is the registry's, not the caller's.** These writes were never
 * independent: several move a departure or a head count the next one reads. The
 * order below is the order the route always wrote them in, so a list names what
 * it wants and the registry decides when.
 *
 * A fact is **opt-in** because it moves something other captures show: a
 * readiness, a head count, a departure, a Today row. The demo stays calm and
 * the capture that wants the trouble names it. {@link FACT_SETS} are the named
 * groups (a shop is a named fact set); `troublePanels` is the back-office
 * panels the route wrote on every call before facts were named.
 */
export type FactContext = {
  db: AppDb;
  shop: { id: string; timezone: string };
  actorId: string;
  now: Date;
};

type Fact = (context: FactContext) => Promise<unknown>;

const FACTS = {
  noCardDeclared: ({ db, shop, now }) => declareNoCard(db, shop.id, now),
  stuckPayment: ({ db, shop, now }) => leavePaymentUnconfirmed(db, shop.id, now),
  owedMoney: ({ db, shop, now }) => seedOwedMoney(db, shop.id, now),
  owedRefund: ({ db, shop }) => cancelADepartureSomebodyPaidFor(db, shop.id),
  stuckMediaDeletion: ({ db, shop, now }) => refuseAPhotoDelete(db, shop.id, now),
  owedErasures: ({ db, shop, actorId, now }) => oweStripeTwoErasures(db, shop.id, actorId, now),
  ratingWithheld: ({ db, shop, actorId }) =>
    hideEnoughReviewsToWithholdTheRating(db, shop.id, actorId),
  mixedWaiverDelivery: ({ db, shop }) => markMixedWaiverDelivery(db, shop.id),
  gearOverdue: ({ db, shop, now }) => runGearOverdue(db, shop.id, now, shop.timezone),
  blockedAboard: ({ db, shop, now }) => boardADiverThenBlockThem(db, shop.id, now),
  failedEmails: ({ db, shop, now }) => bounceThreeConfirmations(db, shop.id, now),
  crewUncounted: ({ db, shop, now }) => boardEveryDiverAndNoCrew(db, shop.id, now),
  gearOut: ({ db, shop, now }) => putOneUnitOutToday(db, shop.id, now, shop.timezone),
  bench: ({ db, shop, now }) => putTheBenchBehind(db, shop.id, now, shop.timezone),
  crewGap: ({ db, shop, now }) => unstaffTomorrowsDeparture(db, shop.id, now),
  unitsNeedingCare: ({ db, shop, actorId, now }) =>
    flagFourUnitsOnTheReefBoat(db, shop.id, actorId, now, shop.timezone),
  introOverRatio: ({ db, shop, actorId, now }) =>
    askForAnIntroSessionPastItsRatio(db, shop.id, actorId, now, shop.timezone),
  blockedMinor: ({ db, shop, now }) => unsignTheSeededMinorsRelease(db, shop.id, now),
  crewClash: ({ db, shop, now }) => slideOneDepartureOntoAnother(db, shop.id, now, shop.timezone),
  crewClashSailed: ({ db, shop, now }) =>
    slideOneDepartureOntoAnother(db, shop.id, now, shop.timezone, {
      hostSailedAt: new Date(now.getTime() - 2 * HOUR_MS),
    }),
  identityHeld: ({ db, shop, actorId, now }) =>
    seatSomebodyOffTheNamePrompt(db, shop.id, actorId, now),
  moveBlocked: ({ db, shop, now }) => countHeadsOnADepartureNobodyWillMove(db, shop.id, now),
  farStation: ({ db, shop }) => addASiteItsStationIsNowhereNear(db, shop.id),
  droppedRental: ({ db, shop }) => askForAPieceTheShopNoLongerRents(db, shop.id),
  mixedBoat: ({ db, shop, actorId, now }) => carrySomebodyWhoIsNotDiving(db, shop.id, actorId, now),
  runningLate: ({ db, shop, now }) => sayPriyaIsRunningLate(db, shop.id, now),
  boatSafety: ({ db, shop, now }) => letTheReefBoatsKitLapse(db, shop.id, now, shop.timezone),
  rehearsal: ({ db, shop, actorId, now }) => putARehearsalOnTomorrow(db, shop.id, actorId, now),
  monthSightings: ({ db, shop, actorId, now }) =>
    logPastSeasonsOfThisMonth(db, shop.id, actorId, now, shop.timezone),
  reviewReply: ({ db, shop, actorId }) => answerTheNewestReview(db, shop.id, actorId),
  checkedInBlocked: ({ db, shop, now }) => checkInADiverThenBlockThem(db, shop.id, now),
  uncountedSeat: ({ db, shop }) => leaveASeatUncounted(db, shop.id),
  partyWaiverCapacity: ({ db, shop }) => makeRoomForPartyWaiverCaptures(db, shop.id),
  gearConcern: ({ db, shop, now }) =>
    returnTheBenchedUnitWithAConcern(db, shop.id, now, shop.timezone),
  rentalWaiverWarning: ({ db, shop, now }) =>
    lendAMaskToSomeoneWithNoWaiver(db, shop.id, now, shop.timezone),
  rentalLookup: ({ db, shop, now }) => seedRentalLookupFleet(db, shop.id, now),
  gearUncollected: ({ db, shop, now }) => leaveTwoUnitsUncollected(db, shop.id, now, shop.timezone),
  boatClash: ({ db, shop, now }) => slideOneDepartureOntoAnotherHull(db, shop.id, now),
  mergeCandidates: ({ db, shop, now }) => mergeCandidatesState(db, shop.id, now),
  manifestOverCapacity: ({ db, shop, now }) => seedManifestOverCapacityState(db, shop.id, now),
} satisfies Record<string, Fact>;

export type FactName = keyof typeof FACTS;

/** Named groups of facts: a list may name a set where it would name each member. */
export const FACT_SETS = {
  /** The back-office panels the trouble route wrote on every call, until each was named. */
  troublePanels: [
    "noCardDeclared",
    "stuckPayment",
    "owedMoney",
    "stuckMediaDeletion",
    "owedErasures",
    "ratingWithheld",
    "mixedWaiverDelivery",
    "gearOverdue",
  ],
} as const satisfies Record<string, readonly FactName[]>;

const REGISTRY_ORDER = Object.keys(FACTS) as FactName[];

function isFactName(name: string): name is FactName {
  return Object.hasOwn(FACTS, name);
}

function isFactSet(name: string): name is keyof typeof FACT_SETS {
  return Object.hasOwn(FACT_SETS, name);
}

/** Every fact and set a list may name, for the refusal that says what was meant. */
export function knownFactNames(): string[] {
  return [...REGISTRY_ORDER, ...Object.keys(FACT_SETS)].sort();
}

/** What a list resolves to: the facts to write, in registry order, or the names nobody knows. */
export function resolveFacts(
  requested: readonly string[],
): { ok: true; facts: FactName[] } | { ok: false; unknown: string[] } {
  const unknown = requested.filter((name) => !isFactName(name) && !isFactSet(name));
  if (unknown.length > 0) return { ok: false, unknown };
  const wanted = new Set<string>();
  for (const name of requested) {
    if (isFactSet(name)) for (const member of FACT_SETS[name]) wanted.add(member);
    else wanted.add(name);
  }
  return { ok: true, facts: REGISTRY_ORDER.filter((name) => wanted.has(name)) };
}

/**
 * Write the named facts, in registry order, and answer with each one's value
 * keyed by its name. A name nobody knows throws: the route refuses it first
 * ({@link resolveFacts}), so reaching here with one is a programming error.
 */
export async function applyFacts(
  requested: readonly string[],
  context: FactContext,
): Promise<Record<string, unknown>> {
  const resolved = resolveFacts(requested);
  if (!resolved.ok) throw new Error(`unknown facts: ${resolved.unknown.join(", ")}`);
  const values: Record<string, unknown> = {};
  for (const name of resolved.facts) {
    const value = await FACTS[name](context);
    if (value !== null && value !== undefined) values[name] = value;
  }
  return values;
}
