import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  PaymentStatus,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
import { checkMinimumAge } from "./age";
import type { CalendarDate } from "./calendar-date";
import { nowDate } from "./clock";
import { waiverState } from "./waivers";

/** Payment states that clear the "ready to board" payment gate. */
const PAYMENT_CLEARED: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "deposit_paid",
  "paid",
  "waived",
]);

/**
 * **A payment gate on a departure with no price is a gate nobody can clear.**
 *
 * `checkoutCharge` (`src/lib/deposits.ts`) returns null for an unpriced trip,
 * so `startBookingCheckout` refuses with `unpriced`, so the public booking
 * action sends the diver to the ordinary booked landing without asking for
 * money — and their booking stays `unpaid`, which raises `payment_due` below,
 * permanently, for them and for every diver who books afterwards. There is no
 * way out from the diver's side and only one from the shop's: marking each
 * person paid or waived by hand, on a departure that never asked for money.
 *
 * The demo shop was publicly selling one (issue #692). Both forms that can
 * produce the combination refuse it now: the requirements form (ticking the
 * gate onto an unpriced departure) and the details form (clearing the price
 * from a gated one).
 *
 * Deliberately **not** solved by letting an unpriced trip clear the gate.
 * `PAYMENT_CLEARED` includes `waived` because `waived` means a human decided;
 * deriving that from "the shop forgot a price" turns a data error into a silent
 * boarding clearance on a safety surface.
 */
export function paymentGateIsUnclearable(
  requiresPayment: boolean,
  priceCents: number | null,
): boolean {
  // `<= 0` as well as null: `checkoutCharge` refuses a zero price by the same
  // test, so a departure priced at nothing gates exactly as hard as an unpriced
  // one.
  return requiresPayment && (priceCents === null || priceCents <= 0);
}

/**
 * The five-rung certification ladder. Labels for these — and for
 * `DiveSpecialty` below — live in the message bundles
 * (`src/i18n/readiness-labels.ts` maps each code to a translation key), never
 * here: this file states facts about ordering and gates, `src/app` chooses
 * words.
 */
export type CertificationLevel =
  | "open_water"
  | "advanced_open_water"
  | "rescue"
  | "divemaster"
  | "instructor";

const levelRank: Record<CertificationLevel, number> = {
  open_water: 1,
  advanced_open_water: 2,
  rescue: 3,
  divemaster: 4,
  instructor: 5,
};

/** A level's place on the ladder, for ordering rather than comparison. Open Water is 1. */
export function certificationRank(level: CertificationLevel): number {
  return levelRank[level];
}

/**
 * **What a site or a trip may demand of a diver — the top of it is Rescue.**
 *
 * Deliberately a different set from `CertificationLevel`, which is what a
 * person can *hold*. Divemaster and Instructor are working ratings: crew hold
 * them, `src/lib/course-ratios.ts` counts them, and an instructor-led session
 * is gated on one being assigned. None of that is a shop telling a paying
 * diver to hold a professional rating to board a charter, which is the only
 * thing this list is for (issue #630).
 *
 * It stops at Rescue because Rescue is the highest *modelled* recreational
 * rung. Master Scuba Diver is not one: MSD is Rescue plus five specialties
 * plus fifty dives, which a linear ladder cannot express, and the import path
 * deliberately files it under `level_not_gated`
 * (ADR 20260725-imported-card-sighting).
 *
 * The `satisfies` is the same guard `DECLARABLE_CERTIFICATION_LEVELS` carries:
 * a rung spelled wrong here is a compile error rather than a requirement
 * nobody can pick.
 */
export const REQUIRABLE_CERTIFICATION_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
] as const satisfies readonly CertificationLevel[];

/** A level a site or trip is allowed to demand — see the list above. */
export type RequirableCertificationLevel = (typeof REQUIRABLE_CERTIFICATION_LEVELS)[number];

/** The stricter of two levels; null means "no level demanded" and never wins. */
export function higherCertificationLevel(
  a: CertificationLevel | null | undefined,
  b: CertificationLevel | null | undefined,
): CertificationLevel | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return levelRank[a] >= levelRank[b] ? a : b;
}

/**
 * Anything that can demand cards of a diver: a trip's own requirement row, a
 * dive site's inherent gate, or the running total of several of them folded
 * together. One shape is what lets a single fold compose them all.
 */
export type CertRequirementSource = {
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: readonly DiveSpecialty[];
  requiresNitrox: boolean;
};

/** A dive site's inherent cert gate, composed into every trip that visits it. */
export type SiteCertRequirement = CertRequirementSource;

/** The identity element of the fold: demands nothing of anybody. */
const NO_CERT_REQUIREMENT: CertRequirementSource = {
  minimumCertificationLevel: null,
  requiredSpecialties: [],
  requiresNitrox: false,
};

/**
 * The gate a diver is actually held to on a trip: the stricter minimum level,
 * the union of specialties, and nitrox if either the trip or its dive site
 * demands it.
 */
export function combineCertRequirements(
  requirement: CertRequirementSource,
  site: SiteCertRequirement | null | undefined,
): {
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
} {
  const specialties = new Set<DiveSpecialty>(requirement.requiredSpecialties ?? []);
  for (const specialty of site?.requiredSpecialties ?? []) specialties.add(specialty);
  return {
    minimumCertificationLevel: higherCertificationLevel(
      requirement.minimumCertificationLevel,
      site?.minimumCertificationLevel,
    ),
    requiredSpecialties: [...specialties],
    requiresNitrox: Boolean(requirement.requiresNitrox) || Boolean(site?.requiresNitrox),
  };
}

/**
 * The single gate a trip's *whole* itinerary imposes: every site it visits
 * folded into one requirement — the strictest level, the union of specialties,
 * nitrox if any one of them wants it. The naive version reads only the primary
 * site, which goes quiet on exactly the two-tank day where dive two is the one
 * that needs the card (the same failure `getTripMaxDepthMeters` already fixed
 * for the depth advisory).
 *
 * Null when no visited site demands anything, so callers keep treating "no site
 * requirement" as absent rather than as an empty gate.
 */
export function combineSiteRequirements(
  sites: readonly SiteCertRequirement[],
): SiteCertRequirement | null {
  let combined: CertRequirementSource = NO_CERT_REQUIREMENT;
  for (const site of sites) combined = combineCertRequirements(combined, site);
  if (
    !combined.minimumCertificationLevel &&
    combined.requiredSpecialties.length === 0 &&
    !combined.requiresNitrox
  ) {
    return null;
  }
  return combined;
}

export type ReadinessBlockerCode =
  | "requirements_not_configured"
  | "identity_unconfirmed"
  | "waiver_not_sent"
  | "waiver_pending"
  | "waiver_expired"
  | "medical_review"
  | "certification_missing"
  | "certification_pending"
  | "certification_self_declared"
  | "certification_insufficient"
  | "specialty_missing"
  | "specialty_pending"
  | "specialty_import_unconfirmed"
  | "nitrox_missing"
  | "nitrox_pending"
  | "nitrox_self_declared"
  | "under_minimum_age"
  | "payment_due"
  | "payment_refunded"
  | "readiness_unavailable";

/**
 * The data a translated message needs to fill in its placeholders. Which
 * fields are set depends on `code` — `src/app` looks the code up in a message
 * bundle and interpolates whichever of these the chosen template calls for.
 */
export type ReadinessBlockerParams = {
  requiredLevel?: CertificationLevel;
  specialty?: DiveSpecialty;
  age?: number;
  minimumAge?: number;
};

export type ReadinessBlocker = { code: ReadinessBlockerCode; params?: ReadinessBlockerParams };

/** The requirement family a blocker belongs to, shared by every readiness view. */
export type BlockerCategory = "waiver" | "certification" | "payment" | "setup";

export const BLOCKER_CATEGORY: Record<ReadinessBlockerCode, BlockerCategory> = {
  requirements_not_configured: "setup",
  readiness_unavailable: "setup",
  identity_unconfirmed: "setup",
  waiver_not_sent: "waiver",
  waiver_pending: "waiver",
  waiver_expired: "waiver",
  medical_review: "waiver",
  certification_missing: "certification",
  certification_pending: "certification",
  certification_self_declared: "certification",
  certification_insufficient: "certification",
  specialty_missing: "certification",
  specialty_pending: "certification",
  specialty_import_unconfirmed: "certification",
  nitrox_missing: "certification",
  nitrox_pending: "certification",
  nitrox_self_declared: "certification",
  // "setup", not "certification": age is not a card the diver holds, and it is
  // entirely shop-side work. Filing it here also collapses it into the single
  // generic setup line on the diver's own checklist, which is what keeps the
  // public confirmation panel from disclosing that a given email belongs to
  // someone under a course's minimum age.
  under_minimum_age: "setup",
  payment_due: "payment",
  payment_refunded: "payment",
};

/**
 * **Whether this reason may be named on a screen a queue can read.**
 *
 * Only one surface asks: `/shop/[shopSlug]/check-in` calls itself Counter
 * mode, and it is the one staff screen whose audience is not the person signed
 * in — it sits on the front desk facing a lobby, and the diver second in line
 * reads whatever is on it. That is what put every reason behind a tap there
 * (issue #716), and *"Payment is outstanding for this trip."* printed beside a
 * named person is the sentence that argument was made about.
 *
 * A blanket tap is too blunt in the other direction, though: a collapsed row
 * saying only "Why: 1 reason" makes the one row a staffer must act on the least
 * informative thing in the queue, with the diver standing in front of them
 * (issue #759). So the two facts are told apart rather than traded off — a
 * reason that is ordinary shop paperwork can be said out loud, and a reason
 * that is about somebody's money, health, or age cannot.
 *
 * `false` for exactly four codes, and each for the same reason the rest of the
 * product is careful about them:
 *
 * - **`payment_due` / `payment_refunded`** — what a named person owes. A shop
 *   would not say it out loud in front of the queue, and a staffer reading it
 *   off the screen is what happens next.
 * - **`medical_review`** — a review hold means the diver answered *yes* to
 *   something on the RSTC form. The incident export deliberately carries waiver
 *   *status* and never the answers; this is the same line.
 * - **`under_minimum_age`** — its sentence names the diver's actual age against
 *   the course minimum, i.e. it discloses that this person is a child. This is
 *   the same disclosure `BLOCKER_CATEGORY` files under `setup` to keep off the
 *   diver's own confirmation panel.
 *
 * Everything else is a fact about the shop's paperwork rather than about the
 * person — an unsent waiver, a card nobody has captured, a requirement nobody
 * configured — and is the thing the staffer and the diver are both there to
 * fix.
 *
 * A `Record` and not a `Set`, so a new `ReadinessBlockerCode` is a compile
 * error here and somebody has to decide which half it belongs in.
 */
export const BLOCKER_SAYABLE_AT_COUNTER: Record<ReadinessBlockerCode, boolean> = {
  requirements_not_configured: true,
  readiness_unavailable: true,
  identity_unconfirmed: true,
  waiver_not_sent: true,
  waiver_pending: true,
  waiver_expired: true,
  medical_review: false,
  certification_missing: true,
  certification_pending: true,
  certification_self_declared: true,
  certification_insufficient: true,
  specialty_missing: true,
  specialty_pending: true,
  specialty_import_unconfirmed: true,
  nitrox_missing: true,
  nitrox_pending: true,
  nitrox_self_declared: true,
  under_minimum_age: false,
  payment_due: false,
  payment_refunded: false,
};

/**
 * The first reason a counter screen may name aloud, or `null` when every one of
 * them is somebody's private business. Order is the readiness engine's own,
 * which is worst-first, so this is the most serious sayable reason rather than
 * merely the earliest.
 */
export function firstSayableAtCounter(
  blockers: readonly ReadinessBlocker[],
): ReadinessBlocker | null {
  return blockers.find((blocker) => BLOCKER_SAYABLE_AT_COUNTER[blocker.code]) ?? null;
}

/**
 * **What a blocker aboard a boat is asking of the crew.**
 *
 * `BLOCKER_CATEGORY` answers "which requirement family", which is the right
 * question for a checklist and the wrong one at the rail. Once a diver is on
 * the boat the gate is behind them, and the only question left is what happens
 * before *this diver* gets in the water — and those answers do not line up
 * with the families:
 *
 * - **`medical`** — a review hold. On the RSTC form a "yes" means a doctor must
 *   confirm in writing that the diver is fit, and this app tells the diver
 *   exactly that (`diver.medicalReferral`). It is not the captain's to waive,
 *   not the instructor's, and a crew that waives it has voided the shop's
 *   insurance for that dive. Nobody aboard can clear it.
 * - **`unknown`** — nothing on file that clears them. An unsigned, unsent or
 *   expired waiver means **no medical declaration at all**, not a filing
 *   error; `identity_unconfirmed` means the human aboard may not be the human
 *   whose cards and answers are on file (H-13); `readiness_unavailable` means
 *   the lookup failed, and this module already says a safety surface must
 *   never treat that as a pass; `requirements_not_configured` means nobody's
 *   cards were checked against anything.
 * - **`certification`** — a qualification this dive asks for that the record
 *   does not show: a card missing, unverified, self-declared or too shallow, a
 *   specialty absent, or a diver under the course's minimum age. Sometimes a
 *   card in a dry bag; sometimes a diver who should be on a shallower profile.
 * - **`payment`** — money owed. The only one of the four that genuinely does
 *   not change what happens in the water today.
 *
 * The first three all mean *do not put this diver in the water yet*; only the
 * fourth is office work, and the card said "the fix is in the list below" to
 * every one of them (issue #791, from a `dive-domain-expert` pass over #742,
 * and reshaped by a second pass over the first cut of this).
 *
 * **No role is named in the words these map to.** DiveDay informs and never
 * gates, and naming an authority is the one thing that turns an informing line
 * into an instruction — besides which the captain is responsible for the
 * vessel, while whether a given diver splashes is the dive leader's call, and
 * a pool session has neither.
 *
 * Precedence is worst-first, because a line has room for one reason: a diver
 * held on medical review *and* missing a card is a medical hold. That ordering
 * is right **within one diver** and wrong across a group — see
 * `groupAboardBlockers`.
 */
export type AboardBlockerKind = "medical" | "unknown" | "certification" | "payment";

const ABOARD_KIND: Record<ReadinessBlockerCode, AboardBlockerKind> = {
  medical_review: "medical",

  waiver_not_sent: "unknown",
  waiver_pending: "unknown",
  waiver_expired: "unknown",
  identity_unconfirmed: "unknown",
  readiness_unavailable: "unknown",
  requirements_not_configured: "unknown",

  certification_missing: "certification",
  certification_pending: "certification",
  certification_self_declared: "certification",
  certification_insufficient: "certification",
  specialty_missing: "certification",
  specialty_pending: "certification",
  specialty_import_unconfirmed: "certification",
  nitrox_missing: "certification",
  nitrox_pending: "certification",
  nitrox_self_declared: "certification",
  // An agency hard stop about the diver, the same shape as a card that does not
  // reach the site's depth — not the shop-side "setup" it is filed under in
  // `BLOCKER_CATEGORY`, which is scoped to keeping age off the *public*
  // confirmation panel.
  under_minimum_age: "certification",

  payment_due: "payment",
  payment_refunded: "payment",
};

/** Worst first, so a group can be ordered and a single diver reduced to one. */
const ABOARD_KIND_ORDER: readonly AboardBlockerKind[] = [
  "medical",
  "unknown",
  "certification",
  "payment",
];

export function aboardBlockerKind(blockers: readonly ReadinessBlocker[]): AboardBlockerKind | null {
  const kinds = new Set(blockers.map((blocker) => ABOARD_KIND[blocker.code]));
  return ABOARD_KIND_ORDER.find((kind) => kinds.has(kind)) ?? null;
}

/**
 * **One entry per kind present, worst first — never one reason over a whole
 * count.**
 *
 * The first cut of this returned a single kind for the group, and the card
 * rendered it against the group's total: one medical hold beside four
 * certification gaps produced "5 divers are aboard — a medical hold", which is
 * false about four of the five, in the direction that inflates. Run the other
 * way — one medical hold beside four unsigned waivers — and the four vanish
 * from the line entirely, so a crew clears the one diver they were told about
 * and sails with four who have made no medical declaration.
 *
 * Worst-first is right *within* a diver and wrong *across* them, because the
 * count is a census and the reason is not. Almost always this returns one
 * entry; at worst four, and four true lines beat one false one on a boat.
 */
export function groupAboardBlockers<T>(
  divers: readonly { blockers: readonly ReadinessBlocker[]; value: T }[],
): { kind: AboardBlockerKind; members: T[] }[] {
  const byKind = new Map<AboardBlockerKind, T[]>();
  for (const diver of divers) {
    const kind = aboardBlockerKind(diver.blockers);
    if (kind === null) continue;
    const members = byKind.get(kind);
    if (members) members.push(diver.value);
    else byKind.set(kind, [diver.value]);
  }
  return ABOARD_KIND_ORDER.flatMap((kind) => {
    const members = byKind.get(kind);
    return members ? [{ kind, members }] : [];
  });
}

/**
 * The two states a booking can be in, and the only two. Named so every surface
 * that renders one can key off the same type — the words and tone come from
 * `src/i18n/readiness-labels.ts` (`readinessStatusText`/`readinessStatusTone`),
 * never from the surface itself.
 */
export type ReadinessStatus = "ready" | "blocked";

export type ReadinessResult = {
  status: ReadinessStatus;
  blockers: ReadinessBlocker[];
};

export type ReadinessInput = {
  requirement: TripRequirement | null;
  /** The primary dive site's inherent gate, composed with the trip's own. */
  siteRequirement?: SiteCertRequirement | null;
  waiver: WaiverRecord | null;
  certifications: readonly Certification[];
  specialtyCertifications?: readonly SpecialtyCertification[];
  nitroxCertifications?: readonly NitroxCertification[];
  /** The booking's current payment state; absent is treated as unpaid. */
  paymentStatus?: PaymentStatus | null;
  /**
   * The booking reused an existing person by email under a mismatched name and
   * has not been staff-confirmed (H-13). Fails closed until staff confirm it is
   * the same human, so a shared-inbox booking can't board on borrowed evidence.
   */
  identityUnconfirmed?: boolean;
  /**
   * The course's stated minimum age and the diver's date of birth, if the shop
   * has one on file (H-08). Checked here as well as at booking, because a
   * booking-time-only gate is inert for every diver whose date was recorded
   * *after* they booked — which, since nothing collected dates before this
   * shipped, is nearly all of them. Fails open: no date, no minimum, no
   * blocker.
   */
  courseMinimumAge?: number | null;
  dateOfBirth?: CalendarDate | null;
  /** The shop-local calendar date the course runs, which is when age is measured. */
  courseDate?: CalendarDate | null;
  now?: Date;
};

/** A safety surface must never treat a failed readiness lookup as a pass. */
export function unavailableReadiness(): ReadinessResult {
  return {
    status: "blocked",
    blockers: [{ code: "readiness_unavailable" }],
  };
}

/**
 * **A card the shop has actually seen.** `verified` and nothing else — a
 * recreational certification does not expire, so there is no second condition
 * to check (ADR 20260821-a-card-does-not-expire). What keeps a diver current
 * is when they last dived, which is a different question this does not ask
 * (`src/lib/dive-recency.ts`, ADR 20260821-currency-is-what-catches-people).
 */
export function validVerifiedCertification(certification: Certification): boolean {
  return certification.status === "verified";
}

/**
 * **A card that is still only somebody's word for it.**
 *
 * A diver naming their own level on one of the three public forms that ask —
 * the deal list, a trip's wait list, or the booking form — writes a `pending`
 * card stamped `selfDeclaredAt` (src/db/self-declared-cards.ts). Nobody at the
 * shop has seen anything, and the person may not even be who the email says.
 *
 * **This predicate is what keeps the two gates different.** At the *sale*,
 * `decideTripAdmission` believes a stated card; at the *boat*,
 * `certificationBlocker` gives one its own code rather than clearing on it, so
 * a claim buys a seat and never a place in the water (ADR
 * 20260820-attested-at-booking-verified-at-boarding). It used to be read as
 * absent by both.
 *
 * The stamp stays forever, because where a row began is history. What changes
 * is the `status`: once a staffer has entered the agency and number off a card
 * in their hand, the row is a sighting that happens to have started as a claim,
 * and it counts like any other. That is why this is a *pair* of conditions and
 * not just `selfDeclaredAt !== null`.
 *
 * Shaped structurally rather than over `Certification` so the nitrox table's
 * identical rows go through the same one definition.
 */
export function isUnsightedSelfDeclaration(card: {
  selfDeclaredAt?: Date | string | null;
  status: "pending" | "verified";
}): boolean {
  return Boolean(card.selfDeclaredAt) && card.status === "pending";
}

/** Shared rank check for course admission and final trip readiness. */
export function hasVerifiedCertificationAtLeast(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
): boolean {
  return certifications.some(
    (certification) =>
      validVerifiedCertification(certification) &&
      levelRank[certification.level] >= levelRank[minimumLevel],
  );
}

function certificationBlocker(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
): ReadinessBlocker | null {
  const verified = certifications.filter(validVerifiedCertification);
  if (hasVerifiedCertificationAtLeast(certifications, minimumLevel)) {
    return null;
  }
  // `pending` means **the shop is holding something it can look up** — a card
  // number is on file, waiting on the agency check. A still-unsighted
  // self-declaration *with no number* is `pending` too but the shop is holding
  // nothing at all, so it is excluded here and answered by its own code below.
  // Conflating the two told the diver on /ready "your card is with the shop for
  // verification" about a card that does not exist, and simultaneously withdrew
  // the card-entry form that was their only way to send one
  // (`CERT_ENTRY_CODES`) — a diver who ticked a dropdown was left with no move
  // and arrived at the dock without a card.
  //
  // The exclusion is about the **number**, not the stamp, which is why it asks
  // for both. When a diver types their card in on `/ready`, the row is stamped
  // `selfDeclaredAt` (so a staffer's one-tap promote still demands a sighting —
  // `security-reviewer`, 2026-08-20) *and* carries an identifier. That is a
  // number with the shop awaiting review, so it belongs here: reading it as a
  // bare claim re-offered the entry form to a diver who had just filled it in,
  // and re-typing the same number is refused by the unique index anyway.
  const heldForReview = (certification: Certification) =>
    !isUnsightedSelfDeclaration(certification) || Boolean(certification.identifier);
  if (
    certifications.some(
      (certification) =>
        certification.status === "pending" &&
        heldForReview(certification) &&
        levelRank[certification.level] >= levelRank[minimumLevel],
    )
  ) {
    return { code: "certification_pending" };
  }
  if (verified.length > 0) {
    return { code: "certification_insufficient", params: { requiredLevel: minimumLevel } };
  }
  // Below every state backed by something the shop holds, and above plain
  // `missing` only because it can say more: the diver told us a level and gave
  // no number, so nobody has anything to look up. Both are "the shop is holding
  // nothing usable", and both offer the diver the card-entry form. A claim that
  // *does* carry a number was answered as `pending` above.
  if (
    certifications.some(
      (certification) => isUnsightedSelfDeclaration(certification) && !certification.identifier,
    )
  ) {
    return { code: "certification_self_declared" };
  }
  return { code: "certification_missing" };
}

/**
 * A specialty is a yes/no gate: only a verified, unexpired card of that exact
 * specialty clears it. Every other state fails closed with a specific reason.
 *
 * An *imported* card is the one place a specialty is stricter than the level
 * ladder (ADR 20260725-import-specialty-cards). A migrated ladder card clears
 * its requirement on `verified` alone, because the prior system's cert record
 * is evidence the diver is carded at all. A specialty authorizes a materially
 * riskier dive — deep gates depth past 18 m — so a card that has only ever been
 * a cell in a spreadsheet holds the gate until a staffer taps the one-tap
 * confirm that stamps `reviewedAt`. Boarding is never what waits: the gate is
 * on the specialty dive, and confirming is one tap on the diver's record.
 */
function specialtyBlocker(
  specialtyCertifications: readonly SpecialtyCertification[],
  specialty: DiveSpecialty,
): ReadinessBlocker | null {
  const cards = specialtyCertifications.filter((card) => card.specialty === specialty);
  if (
    cards.some(
      (card) =>
        card.status === "verified" &&
        // Confirmed by a staffer, or never needed confirming (entered by hand).
        (!card.importedAt || card.reviewedAt),
    )
  ) {
    return null;
  }
  // Ahead of `pending` and `missing`: this diver is one tap from cleared, and
  // saying so is what turns a blocker into an action a staffer can take. The
  // `verified` check keeps the two blockers from overlapping — an imported card
  // is written `verified`, so a `pending` card is a capture awaiting review and
  // gets that message instead. Either way the gate stays shut.
  if (cards.some((card) => card.status === "verified" && card.importedAt && !card.reviewedAt)) {
    return { code: "specialty_import_unconfirmed", params: { specialty } };
  }
  if (cards.some((card) => card.status === "pending")) {
    return { code: "specialty_pending", params: { specialty } };
  }
  return { code: "specialty_missing", params: { specialty } };
}

/**
 * Nitrox is a yes/no gate cleared only by a verified enriched-air card. Its
 * evidence lives in nitrox_certifications (which also gates the mix request), and those
 * cards carry no expiry — so there is no expired state, only missing/pending.
 */
function nitroxBlocker(
  nitroxCertifications: readonly NitroxCertification[],
): ReadinessBlocker | null {
  if (nitroxCertifications.some((card) => card.status === "verified")) return null;
  // Same split as the level ladder above: a bare tick on a public opt-in is not
  // a card in a staffer's hand, so it must not tell the diver their nitrox card
  // is with the shop.
  if (
    nitroxCertifications.some(
      (card) => card.status === "pending" && !isUnsightedSelfDeclaration(card),
    )
  ) {
    return { code: "nitrox_pending" };
  }
  if (nitroxCertifications.some(isUnsightedSelfDeclaration)) {
    return { code: "nitrox_self_declared" };
  }
  return { code: "nitrox_missing" };
}

/**
 * The shared safety boundary. Every unknown or non-ready input becomes a
 * human-readable blocker; only explicit evidence can produce `ready`.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const now = input.now ?? nowDate();
  const blockers: ReadinessBlocker[] = [];

  // Evaluated ahead of — and independently of — the trip's own requirements: a
  // booking that reused an existing person under a mismatched name must never
  // board on that person's certs/waiver until staff confirm it is the same
  // human (H-13), even on a trip whose requirements aren't configured yet.
  if (input.identityUnconfirmed) {
    blockers.push({ code: "identity_unconfirmed" });
  }

  // Also ahead of the trip's requirements, and for the same reason: an
  // under-age student is under-age whether or not anyone has configured the
  // trip's cert gates yet. Measured on the day the course runs, matching the
  // booking gate (src/db/bookings.ts).
  if (input.courseDate) {
    const age = checkMinimumAge(input.dateOfBirth, input.courseMinimumAge, input.courseDate);
    if (age.status === "under") {
      blockers.push({
        code: "under_minimum_age",
        params: { age: age.age, minimumAge: age.minimumAge },
      });
    }
  }

  if (!input.requirement) {
    blockers.push({ code: "requirements_not_configured" });
    return { status: "blocked", blockers };
  }

  if (input.requirement.requiresWaiver) {
    const state = waiverState(input.waiver, now);
    if (state === "not_sent") blockers.push({ code: "waiver_not_sent" });
    if (state === "awaiting_signature") {
      blockers.push({ code: "waiver_pending" });
    }
    if (state === "expired") blockers.push({ code: "waiver_expired" });
    if (state === "medical_review") {
      blockers.push({ code: "medical_review" });
    }
  }

  const effective = combineCertRequirements(input.requirement, input.siteRequirement);

  if (effective.minimumCertificationLevel) {
    const certification = certificationBlocker(
      input.certifications,
      effective.minimumCertificationLevel,
    );
    if (certification) blockers.push(certification);
  }

  for (const specialty of effective.requiredSpecialties) {
    const blocker = specialtyBlocker(input.specialtyCertifications ?? [], specialty);
    if (blocker) blockers.push(blocker);
  }

  if (effective.requiresNitrox) {
    const blocker = nitroxBlocker(input.nitroxCertifications ?? []);
    if (blocker) blockers.push(blocker);
  }

  if (input.requirement.requiresPayment) {
    const status = input.paymentStatus ?? "unpaid";
    if (!PAYMENT_CLEARED.has(status)) {
      blockers.push({ code: status === "refunded" ? "payment_refunded" : "payment_due" });
    }
  }
  return { status: blockers.length === 0 ? "ready" : "blocked", blockers };
}
