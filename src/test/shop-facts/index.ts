import type { z } from "zod";
import type { AppDb } from "../../db/client";
import { HOUR_MS } from "../../lib/clock";
import { addASiteItsStationIsNowhereNear } from "./add-a-site-its-station-is-nowhere-near";
import { answerTheNewestReview } from "./answer-the-newest-review";
import { askForAPieceTheShopNoLongerRents } from "./ask-for-a-piece-the-shop-no-longer-rents";
import { askForAnIntroSessionPastItsRatio } from "./ask-for-an-intro-session-past-its-ratio";
import { boardADiverThenBlockThem } from "./board-a-diver-then-block-them";
import { boardEveryDiverAndNoCrew } from "./board-every-diver-and-no-crew";
import { slideOneDepartureOntoAnotherHull } from "./boat-clash";
import { checkInADiverThenBlockThem, leaveASeatUncounted } from "./boat-states";
import { bookOneInstructorTwice } from "./book-one-instructor-twice";
import { bounceThreeConfirmations } from "./bounce-three-confirmations";
import { bringEveryBoatHome, eveningArgs } from "./bring-every-boat-home";
import { cancelADepartureSomebodyPaidFor } from "./cancel-a-departure-somebody-paid-for";
import { carrySomebodyWhoIsNotDiving } from "./carry-somebody-who-is-not-diving";
import {
  seedCashReceipt,
  seedCollectionBilling,
  seedMixedCashReceipt,
  seedMixedDeposit,
} from "./collection-billing";
import { countHeadsOnADepartureNobodyWillMove } from "./count-heads-on-a-departure-nobody-will-move";
import { crewARatingThatStartsTomorrow } from "./crew-a-rating-that-starts-tomorrow";
import {
  bookingHandoffArgs,
  handADiverTheNextDeparture,
  lastMinuteInterestArgs,
  makeADiverReturning,
  pinAddedDateArgs,
  pinWhenARecordWasAdded,
  putSomebodyOnTheLastMinuteList,
  returningDiverArgs,
} from "./diver-states";
import { emptyTheBoard, offSeasonArgs } from "./empty-the-board";
import { executedDepthArgs, seedExecutedDepth } from "./executed-depth";
import { expireThePendingSignIn } from "./expire-the-pending-sign-in";
import { failTheFlySafeCorrections } from "./fail-the-fly-safe-corrections";
import { flagFourUnitsOnTheReefBoat } from "./flag-four-units-on-the-reef-boat";
import {
  leaveTwoUnitsUncollected,
  lendAMaskToSomeoneWithNoWaiver,
  returnTheBenchedUnitWithAConcern,
} from "./gear-states";
import { seedGroupHoldLedger } from "./group-hold-ledger";
import { hideEnoughReviewsToWithholdTheRating } from "./hide-enough-reviews-to-withhold-the-rating";
import { leaveACourseFormUnworded } from "./leave-a-course-form-unworded";
import { letTheReefBoatsKitLapse } from "./let-the-reef-boats-kit-lapse";
import { claudeAssistsArgs, lightClaudeAssists } from "./light-claude-assists";
import { logFiveDivesForPrint } from "./log-five-dives-for-print";
import { logPastSeasonsOfThisMonth } from "./log-past-seasons-of-this-month";
import { seedManifestOverCapacityState } from "./manifest-overcapacity-state";
import { markMixedWaiverDelivery } from "./mark-mixed-waiver-delivery";
import { markTwoDepthsOnOneCharter } from "./mark-two-depths-on-one-charter";
import { mergeCandidatesState } from "./merge-candidates-state";
import {
  accountTokenArgs,
  emailArgs,
  mintAContactEmailConfirmation,
  mintACourtesyEmailUnsubscribe,
  mintAnAccountToken,
  mintAnInterestUnsubscribe,
  mintASetupLink,
} from "./mint-tokens";
import { operationalTrustArgs, seedOperationalTrustFact } from "./operational-trust";
import { makeRoomForPartyWaiverCaptures } from "./party-waiver-capacity-state";
import { putARehearsalOnTomorrow } from "./put-a-rehearsal-on-tomorrow";
import { putOneUnitOutToday } from "./put-one-unit-out-today";
import { putTheBenchBehind } from "./put-the-bench-behind";
import { readTheWaiverRequest, waiverRequestLinkArgs } from "./read-the-waiver-request";
import {
  certifyTheRecapDiver,
  diveTheRecapSomewhereElse,
  fileAPulseOnTheRecap,
  findTheOtherSharedPhoto,
  recordASightingOnTheRecap,
  returnTheConservationRecap,
  shareTheRecapPhoto,
  timeEveryRecapDive,
} from "./recap-states";
import { FactRefused } from "./refusal";
import { seedRentalLookupFleet } from "./rental-lookup-state";
import { sayPriyaIsRunningLate } from "./say-priya-is-running-late";
import { seatSomebodyOffTheNamePrompt } from "./seat-somebody-off-the-name-prompt";
import { seedOwedMoney } from "./seed-owed-money";
import { departTripArgs, sendADepartureOut } from "./send-a-departure-out";
import {
  failTheLatestBackup,
  giveTheFirstBoatAPhoto,
  pinStaffSessionsSeenNow,
} from "./settings-states";
import { slideOneDepartureOntoAnother } from "./slide-one-departure-onto-another";
import {
  connectStripe,
  diverEmailArgs,
  openABookingCheckout,
  openAPackageInvoice,
  raiseAnInvoiceOnARealShapedShop,
} from "./take-payments";
import { takeASeatSinceTheOwnerLooked } from "./today-catch-up";
import {
  declareNoCard,
  leavePaymentUnconfirmed,
  oweStripeTwoErasures,
  refuseAPhotoDelete,
  runGearOverdue,
} from "./trouble-panels";
import { unsignTheSeededMinorsRelease } from "./unsign-the-seeded-minors-release";
import { unstaffTomorrowsDeparture } from "./unstaff-tomorrows-departure";
import { mintAVisualLink, visualLinkArgs } from "./visual-links";

export { FactRefused } from "./refusal";

/**
 * **A test shop's state is a list of named facts** (issue #2759). One
 * vocabulary and one door: `POST /api/test/shop` takes `{ slug?, mint?, facts }`
 * and answers each fact's value keyed by its name. Each fact writes through the
 * product's writers where one exists, so a fixture is a day the product could
 * have produced.
 *
 * What a fact is handed: the database, the shop (its id, slug and timezone),
 * one of the shop's own people (for the rows that name who acted), the clock's
 * instant, and the request the door was asked with (its headers and origin, for
 * the two facts that answer the caller's own browser). A fact that takes
 * arguments names them in a strict schema, and the caller passes them in the
 * list as `{ name, ...args }`; a bare name passes none. What a fact returns is
 * its answer to the caller; a fact with nothing to say returns nothing and is
 * omitted. A fact that cannot be written throws {@link FactRefused}.
 *
 * **Order is the registry's, not the caller's.** These writes were never
 * independent: several move a departure or a head count the next one reads, and
 * a payment fact needs the shop connected first. The order below is the order
 * they are written in, so a list names what it wants and the registry decides
 * when.
 *
 * A fact is **opt-in** because it moves something other captures show: a
 * readiness, a head count, a departure, a Today row. The demo stays calm and
 * the capture that wants the state names it. {@link FACT_SETS} are the named
 * groups; `troublePanels` is the back-office panels the trouble route wrote on
 * every call before facts were named. A **private** fact changes shop-wide
 * settings or the shop's demo flag, so the door refuses it on the canonical
 * `blue-mantis` fixture every spec shares.
 */
export type FactContext = {
  db: AppDb;
  shop: { id: string; slug: string; timezone: string };
  actorId: string;
  now: Date;
  request?: { headers: Headers; origin: string };
};

type Fact = (context: FactContext) => Promise<unknown>;

/** A fact with arguments, or one only a private shop may take. */
type FactSpec = {
  args?: z.ZodType;
  privateOnly?: true;
  apply: (context: FactContext, args: unknown) => Promise<unknown>;
};

function withArgs<Schema extends z.ZodType>(
  args: Schema,
  apply: (context: FactContext, args: z.output<Schema>) => Promise<unknown>,
  options: { privateOnly?: true } = {},
): FactSpec {
  return { args, apply: (context, raw) => apply(context, raw as z.output<Schema>), ...options };
}

function privateOnly(apply: Fact): FactSpec {
  return { apply: (context) => apply(context), privateOnly: true };
}

function requestOf(context: FactContext) {
  if (!context.request) throw new FactRefused("needs_request");
  return context.request;
}

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
  operationalTrust: withArgs(operationalTrustArgs, ({ db, shop, now }, args) =>
    seedOperationalTrustFact(db, shop, args, now),
  ),
  fiveDivePrint: ({ db, shop, now }) => logFiveDivesForPrint(db, shop, now),
  flySafeFollowUp: ({ db, shop, now }) => failTheFlySafeCorrections(db, shop, now),
  futureCrew: privateOnly(({ db, shop, now }) => crewARatingThatStartsTomorrow(db, shop, now)),
  executedDepth: withArgs(
    executedDepthArgs,
    ({ db, shop }, args) => seedExecutedDepth(db, shop.id, args),
    { privateOnly: true },
  ),
  mixedDepth: ({ db, shop, now }) => markTwoDepthsOnOneCharter(db, shop, now),
  mixedTraining: ({ db, shop, now }) => bookOneInstructorTwice(db, shop, now),
  boatPhoto: privateOnly(({ db, shop }) => giveTheFirstBoatAPhoto(db, shop)),
  backupFailed: ({ db, shop, now }) => failTheLatestBackup(db, shop, now),
  staffSessionsSeenNow: privateOnly(({ db, shop, now }) => pinStaffSessionsSeenNow(db, shop, now)),
  cashReceipt: privateOnly(({ db, shop, actorId, now }) => seedCashReceipt(db, shop, actorId, now)),
  collectionBilling: privateOnly(({ db, shop, actorId, now }) =>
    seedCollectionBilling(db, shop, actorId, now),
  ),
  mixedCashReceipt: privateOnly(({ db, shop, actorId, now }) =>
    seedMixedCashReceipt(db, shop, actorId, now),
  ),
  mixedDeposit: privateOnly(({ db, shop, now }) => seedMixedDeposit(db, shop, now)),
  authChallengeExpired: privateOnly((context) =>
    expireThePendingSignIn(context.db, context.shop, requestOf(context).headers, context.now),
  ),
  evening: withArgs(eveningArgs, ({ db, shop, now }, args) =>
    bringEveryBoatHome(db, shop, args, now),
  ),
  departTrip: withArgs(departTripArgs, ({ db, shop, now }, args) =>
    sendADepartureOut(db, shop.id, args, now),
  ),
  offSeason: withArgs(offSeasonArgs, ({ db, shop, now }, args) =>
    emptyTheBoard(db, shop.id, args, now),
  ),
  returnedConservationRecap: ({ db, shop, now }) => returnTheConservationRecap(db, shop.id, now),
  certifiedRecap: ({ db, shop }) => certifyTheRecapDiver(db, shop.id),
  changedDiveSite: ({ db, shop }) => diveTheRecapSomewhereElse(db, shop.id),
  observedSpecies: ({ db, shop }) => recordASightingOnTheRecap(db, shop.id),
  diveTimes: ({ db, shop }) => timeEveryRecapDive(db, shop.id),
  recapPulse: ({ db, shop }) => fileAPulseOnTheRecap(db, shop.id),
  sharedRecapPhoto: ({ db, shop, now }) => shareTheRecapPhoto(db, shop.id, now),
  secondarySharedPhoto: ({ db, shop }) => findTheOtherSharedPhoto(db, shop.id),
  unwordedCourseForm: ({ db, shop }) => leaveACourseFormUnworded(db, shop.id),
  pinAddedDate: withArgs(pinAddedDateArgs, ({ db, shop, now }, args) =>
    pinWhenARecordWasAdded(db, shop.id, args, now),
  ),
  returningDiver: withArgs(returningDiverArgs, ({ db, shop, now }, args) =>
    makeADiverReturning(db, shop.id, args, now),
  ),
  lastMinuteInterest: withArgs(lastMinuteInterestArgs, ({ db, shop }, args) =>
    putSomebodyOnTheLastMinuteList(db, shop.id, args),
  ),
  todayCatchUp: privateOnly(({ db, shop, now }) => takeASeatSinceTheOwnerLooked(db, shop, now)),
  stripeAccount: ({ db, shop }) => connectStripe(db, shop),
  groupHoldLedger: privateOnly(({ db, shop, now }) => seedGroupHoldLedger(db, shop.id, now)),
  expiredGroupHoldLedger: privateOnly(({ db, shop, now }) =>
    seedGroupHoldLedger(db, shop.id, now, true),
  ),
  bookingCheckout: withArgs(diverEmailArgs, (context, args) =>
    openABookingCheckout(context.db, context.shop.id, args, requestOf(context).origin, context.now),
  ),
  openPackageInvoice: withArgs(diverEmailArgs, ({ db, shop }, args) =>
    openAPackageInvoice(db, shop.id, args),
  ),
  bookingHandoff: withArgs(bookingHandoffArgs, ({ db, shop, now }, args) =>
    handADiverTheNextDeparture(db, shop, args, now),
  ),
  accountToken: withArgs(accountTokenArgs, ({ db }, args) => mintAnAccountToken(db, args)),
  contactEmailConfirmation: ({ db, shop }) => mintAContactEmailConfirmation(db, shop.id),
  courtesyEmailUnsubscribe: withArgs(emailArgs, ({ db, shop }, args) =>
    mintACourtesyEmailUnsubscribe(db, shop.id, args),
  ),
  interestUnsubscribe: withArgs(emailArgs, ({ db, shop }, args) =>
    mintAnInterestUnsubscribe(db, shop.id, args),
  ),
  setupLink: ({ db }) => mintASetupLink(db),
  waiverRequestLink: withArgs(waiverRequestLinkArgs, ({ db, shop, now }, args) =>
    readTheWaiverRequest(db, shop.id, args, now),
  ),
  visualLink: withArgs(
    visualLinkArgs,
    ({ db, shop, now }, args) => mintAVisualLink(db, shop, args, now),
    { privateOnly: true },
  ),
  chargeToRoomInvoice: privateOnly(({ db, shop }) => raiseAnInvoiceOnARealShapedShop(db, shop.id)),
  claudeAssists: withArgs(
    claudeAssistsArgs,
    ({ db, shop, now }, args) => lightClaudeAssists(db, shop.id, args, now),
    { privateOnly: true },
  ),
} satisfies Record<string, Fact | FactSpec>;

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

function specOf(name: FactName): FactSpec {
  const entry: Fact | FactSpec = FACTS[name];
  return typeof entry === "function" ? { apply: (context) => entry(context) } : entry;
}

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

/** One entry of a caller's list: a fact or set by name, or a fact with its arguments. */
export type FactRequest = string | ({ name: string } & Record<string, unknown>);

/** A fact the door will write, with the arguments its schema accepted. */
export type ResolvedFact = { name: FactName; args: unknown; privateOnly: boolean };

export type FactResolution =
  | { ok: true; facts: ResolvedFact[] }
  | { ok: false; unknown: string[]; invalid: Array<{ name: string; issues: string[] }> };

/**
 * What a list resolves to: the facts to write, in registry order, each with its
 * parsed arguments; or the names nobody knows and the arguments a fact refused.
 * A set expands to its members; naming one fact twice with arguments is refused,
 * because which of the two was meant is the caller's to say.
 */
export function resolveFacts(requested: readonly FactRequest[]): FactResolution {
  const unknown: string[] = [];
  const invalid: Array<{ name: string; issues: string[] }> = [];
  const wanted = new Map<FactName, unknown>();
  const given = new Set<FactName>();
  const want = (name: FactName, raw: Record<string, unknown> | null) => {
    if (raw && given.has(name)) {
      invalid.push({ name, issues: ["named twice with arguments"] });
      return;
    }
    if (!raw && wanted.has(name)) return;
    const spec = specOf(name);
    if (!spec.args) {
      if (raw && Object.keys(raw).length > 0) {
        invalid.push({ name, issues: ["takes no arguments"] });
        return;
      }
      wanted.set(name, undefined);
    } else {
      const parsed = spec.args.safeParse(raw ?? {});
      if (!parsed.success) {
        invalid.push({ name, issues: parsed.error.issues.map((issue) => issue.message) });
        return;
      }
      wanted.set(name, parsed.data);
    }
    if (raw) given.add(name);
  };
  for (const entry of requested) {
    if (typeof entry === "string") {
      if (isFactSet(entry)) for (const member of FACT_SETS[entry]) want(member, null);
      else if (isFactName(entry)) want(entry, null);
      else unknown.push(entry);
      continue;
    }
    const { name, ...raw } = entry;
    if (isFactName(name)) want(name, raw);
    else unknown.push(name);
  }
  if (unknown.length > 0 || invalid.length > 0) return { ok: false, unknown, invalid };
  return {
    ok: true,
    facts: REGISTRY_ORDER.filter((name) => wanted.has(name)).map((name) => ({
      name,
      args: wanted.get(name),
      privateOnly: specOf(name).privateOnly === true,
    })),
  };
}

/**
 * Write the named facts, in registry order, and answer with each one's value
 * keyed by its name. A list the registry refuses throws: the door refuses it
 * first ({@link resolveFacts}), so reaching here with one is a programming
 * error. A fact that cannot be written throws {@link FactRefused}.
 */
export async function applyFacts(
  requested: readonly FactRequest[],
  context: FactContext,
): Promise<Record<string, unknown>> {
  const resolved = resolveFacts(requested);
  if (!resolved.ok) {
    const named = [...resolved.unknown, ...resolved.invalid.map((entry) => entry.name)];
    throw new Error(`facts refused: ${named.join(", ")}`);
  }
  const values: Record<string, unknown> = {};
  for (const { name, args } of resolved.facts) {
    const value = await specOf(name).apply(context, args);
    if (value !== null && value !== undefined) values[name] = value;
  }
  return values;
}
