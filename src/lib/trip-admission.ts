import type {
  Certification,
  CertificationAgency,
  DiveSpecialty,
  NitroxCertification,
  SpecialtyCertification,
} from "@/db/schema";
import { certificationRank } from "./certification-levels";
import { isDiver, type ParticipantType } from "./participant-types";
import {
  type CertificationLevel,
  levelStanding,
  type ReadinessBlocker,
  type StandingEvidence,
  standing,
} from "./readiness";
import { type Requirement, requirementDemandsNothing, unionRequirements } from "./requirement";
import {
  markedTrainingRequirement,
  type TrainingDiveCourse,
  type TrainingDiveReach,
  type TripLevelRequirement,
} from "./training-mark";

/**
 * **Can this diver be sold a seat on this trip at all?**
 *
 * A trip's certification, specialty, and nitrox gates used to be read only by
 * the readiness engine, which decides who *boards*. That left a real hole: a
 * diver whose card this shop has already looked up and recorded as Open Water
 * could book — and, on a pay-at-booking charter, pay in full for — an
 * Advanced-only deep wreck, and only find out at the dock (DOM-M6).
 * `decideTripAdmission` is the booking-time half of that gate, and it asks a
 * deliberately narrower question than readiness does.
 *
 * **Readiness asks "is this diver cleared right now?" — admission asks "could
 * this diver ever be cleared for this trip?"** Everything readiness refuses
 * that a person can still fix before the boat leaves — an unsigned waiver, a
 * card captured but not yet verified, a payment outstanding — is *not* a reason
 * to refuse the sale. Only a settled impossibility is.
 *
 * **Absence of evidence is never a refusal.** A shop that has never carded this
 * diver knows nothing about them, and refusing there would lock out every new
 * customer and every diver whose cards predate this rule shipping. That is the
 * same trade-off the product owner already settled for the course minimum-age
 * gate (docs/product/human-decisions/ H-20260724-certification-levels-agency-rules: "collect a date of birth, fail
 * open"; the fail-closed option was declined for exactly this blast radius),
 * and this rule follows it rather than inventing a second policy. Readiness and
 * the dock still hold that line — nothing here weakens them.
 *
 * Note what is deliberately *not* consulted: verification status. It is a state
 * a diver or a staffer can move before departure, so it cannot make a seat
 * impossible. What cannot be moved by paperwork is the rung of the ladder a
 * diver stands on and whether they hold a specialty card at all.
 *
 * **Why ignoring `status` is safe, and what would make it unsafe.** A `pending`
 * card is *almost* never a self-assertion: with one stamped exception, divers
 * cannot write cards. The callers of `createCertification` /
 * `createSpecialtyCertification` / `createNitroxCertification` are the
 * authenticated staff surface `src/app/shop/[shopSlug]/divers/[personId]/card-actions.ts`
 * and the staff-run contact importer, so those rows are a staffer's
 * transcription of something they were handed. `pending` there means "a staffer
 * typed it, nobody has looked the number up with the agency yet" — a queue
 * state, not a claim by the person taking the seat. Readiness is what waits for
 * the lookup.
 *
 * **A stated card is taken at its word here, and only here** (H-20260803-booking-time-trip-admission/H-20260820-shophasadjudicated-src-lib-trip,
 * product owner 2026-08-20). Every certification row is evidence at booking
 * time, whatever its status and whoever wrote it: staff-typed, imported, or the
 * diver's own declaration from a public form. The rung a diver stands on is a
 * thing they can tell you, and telling you is how the number reaches the verify
 * queue in time to be checked before the date.
 *
 * This deliberately reverses an earlier reading of the same code. It used to
 * drop every `isUnsightedSelfDeclaration` row, on the argument that a
 * diver-writable card "would turn this gate into self-attestation — a refused
 * diver could type the level the boat demands and be admitted on the next
 * attempt". **That is true and it is no longer treated as a defect**, because
 * this gate was never the thing standing between a diver and the water:
 *
 * - **Readiness is.** `certificationBlocker` clears on a `verified` card and
 *   nothing else, so a claim gets a diver a seat and never a place on the boat.
 *   The two gates are supposed to differ; this is the difference.
 * - **A gate that can be talked past has to be worth its refusals.** Refusing
 *   carded regulars — the divers a shop knows exactly — while admitting
 *   strangers who have said nothing is inverted relative to risk (H-20260803-booking-time-trip-admission). What
 *   the refusal is *for* is telling somebody at the sale that this boat needs
 *   Advanced, so they buy the trip they can dive.
 *
 * What has **not** changed: a shop with nothing at all on file still admits
 * (H-20260724-certification-levels-agency-rules's fail-open promise), and the anti-displacement rule in
 * `recordSelfDeclaredCards` still means a claim can never be written over a
 * real card. So no diver whose shop holds actual evidence is judged on
 * somebody's typing.
 */

/** The diver's certification evidence at this shop, as the db layer hands it up. */
export type TripAdmissionEvidence = {
  certifications: readonly Certification[];
  specialtyCertifications: readonly SpecialtyCertification[];
  nitroxCertifications: readonly NitroxCertification[];
  /**
   * Levels this diver is booked to be certified at before the trip starts:
   * a course that certifies the level, finishing before the trip
   * (`src/db/certifications-in-training.ts`). A fun dive the morning after an
   * Open Water course is the plan, so the seat sells; readiness still waits
   * for the card the instructor issues.
   */
  levelsInTraining?: readonly CertificationLevel[];
  /**
   * The courses of this diver's course seats that a staff training mark could
   * name on this departure, with an instructor of the course aboard it for one
   * more seat (issue #2731). Readiness lowers a site's level to such a
   * course's minimum once staff mark the seat (`trainingDiveSiteRequirement`),
   * never a level the trip itself set (issue #3776; a default nobody chose
   * counts as the site's, issue #3872), so the sale must not refuse a level
   * that would then clear, and must not sell one that would not.
   */
  trainingDives?: readonly TrainingDiveCourse[];
  /**
   * How far `trainingDives` lower on this departure (`trainingDiveReach`,
   * issue #3910), as readiness reads it. `site` when omitted.
   */
  trainingDiveReach?: TrainingDiveReach;
};

/**
 * Why the sale was refused: **the ladder's own blockers at the sale threshold**
 * (`standing(…, "sale")` in src/lib/readiness.ts), never a second shape. Codes,
 * not sentences (ADR 20260731-domain-layer-copy-leaks), and only four of them
 * can appear, in the ladder's order (level, then each specialty, then nitrox):
 *
 * - `certification_insufficient` with `requiredLevel` and `heldLevel`: the
 *   highest rung this decision saw, whatever its status, **including the claim
 *   this submitter just typed**. On a refusal nothing is persisted, so a
 *   declared rung here is in no record at all; the staff copy that words it as
 *   "on file" is only reachable from staff doors, which pass no declaration.
 * - `certification_missing` with `requiredLevel`: nothing names a rung at all.
 * - `specialty_missing` with `specialty`, once per specialty with no card of
 *   that specialty in any state.
 * - `nitrox_missing`: no enriched-air card in any state, and no tick.
 *
 * The ladder raises each at `sale` only where it would at `verified` too
 * (`readiness-standing.test.ts`), so on the same evidence and demand readiness
 * holds the diver on the same item. The training-dive exception above lowers
 * only the level, and only as far as a staff mark could.
 */
export type TripAdmissionRefusal = ReadinessBlocker[];

/**
 * Is the shortfall the level alone? The one refusal a booker's own answer can
 * be advised on (`advisable` in src/db/bookings.ts); a missing specialty or
 * nitrox card is never talked past.
 */
export function refusalIsLevelOnly(refusal: TripAdmissionRefusal): boolean {
  return (
    refusal.length > 0 && refusal.every((blocker) => blocker.code.startsWith("certification_"))
  );
}

export type TripAdmission = { admitted: true } | { admitted: false; refusal: TripAdmissionRefusal };

const ADMITTED: TripAdmission = { admitted: true };

/**
 * Does anything at all stand on the record about what this diver holds?
 *
 * **Any live certification row counts** — staff-captured, imported, or the
 * diver's own declaration. The question this asks is "is this diver unknown to
 * us?", and a diver with three cards a staffer typed in last Tuesday is not
 * unknown; nor is one who told us their number on the booking form ten minutes
 *
 * It used to require a **`verified`** row, which contradicted its own name and
 * its own module docstring: the gate already trusted a `pending` staff-typed
 * card for the level comparison two lines below, then read the same diver as a
 * stranger here (H-20260820-shophasadjudicated-src-lib-trip). The practical shape of that bug was a shop mid-backfill
 * whose regulars all walked through a gate their own records should have
 * answered.
 *
 * H-20260724-certification-levels-agency-rules's fail-open promise is untouched, because it never rested on the
 * `verified` marker: a shop that has never carded a diver still has **zero
 * rows**, so every genuinely new customer still books.
 */
function shopHasAdjudicated(certifications: readonly Certification[]): boolean {
  return certifications.length > 0;
}

/**
 * What a person said about their own diving on the form they just submitted.
 * Deliberately not a `Certification`: it has no id, no provenance and no shop
 * behind it, and giving it the shape of a row is how it would end up stored as
 * one by accident.
 */
export type SelfDeclaration = {
  level?: CertificationLevel | null;
  /**
   * The agency and number typed beside the level, when the diver gave them.
   * **Nothing in this module reads either one**, and that is the point of
   * carrying them here rather than in a parallel shape: the sale gate is
   * decided by the rung alone, and a card number is evidence for a human to
   * pre-check before the dive date (issue #630). If a future refusal ever
   * consults `identifier`, it has stopped being evidence and become a second
   * gate on a stranger's typing.
   */
  agency?: CertificationAgency | null;
  identifier?: string | null;
  nitrox?: boolean;
};

export type TripAdmissionInput = {
  /**
   * The trip's own requirement row, or null when the shop hasn't configured
   * one. Its `minimumCertificationIsDefault` (issue #3872) lets a training
   * mark lower a default level; a reader that drops it keeps the level.
   */
  requirement: TripLevelRequirement | null;
  /** Every dive site the trip visits, already folded into one gate (`combineSiteRequirements`). */
  siteRequirement: Requirement | null;
  evidence: TripAdmissionEvidence;
  /**
   * The booking reused an existing person by email under a name that didn't
   * match (H-20260724-one-person-per-email). The certs on that record are then evidence about *someone*,
   * but not provably about the person booking, so they are not read at all and
   * the seat is admitted — readiness already fails closed on the same flag, and
   * judging a possible second human by the first one's cards would be wrong in
   * both directions.
   */
  identityUnconfirmed?: boolean;
  /**
   * **What the person buying the seat just said about themselves**, if the form
   * asked. Not a row and not evidence — it is read for this one decision and
   * persisted only if the booking succeeds, so a refused submission leaves
   * nothing behind on anybody's record.
   *
   * Threaded in rather than written first because the gate runs *before* a
   * brand-new diver's `people` row exists (`createBookingRecord`), so a
   * declaration that had to be a row could never speak for the person it is
   * about. It also means the public form cannot write to a stranger's record by
   * failing: the only path that persists is a completed booking.
   */
  declared?: SelfDeclaration;
  /**
   * True when this trip **is** a course session (`trips.course_id`), rather
   * than a charter.
   *
   * On a training session the **course's own `minimum_certification_level` is
   * the admission rule**, and it is enforced separately and more strictly, in
   * `createBookingRecord`'s `course_prerequisite` gate (which fails closed on
   * anything short of a verified, unexpired card). The itinerary must not add a
   * second, independent gate on top of it, because continuing education is
   * taught *at the sites it certifies people for*: an AOW course's deep
   * adventure dive happens at a site marked `advanced_open_water`, and a Deep
   * specialty course at a site with `requiredSpecialties: ["deep"]`. Reading
   * the site's inherent gate here refused a verified Open Water diver
   * enrolling in the very course that would give them the card — and refused
   * them invisibly and unfixably: the trip page renders no site note on a
   * course session and `saveRequirementsAction` refuses to edit a course
   * session's requirements at all, so the only escape was detaching the dive
   * site and losing the briefing and the depth advisory with it.
   *
   * Readiness is untouched by this: the instructor still sees whatever blocker
   * the site's gate raises for a student, which is the correct place for it —
   * an instructor is in the water either way.
   */
  courseSession?: boolean;
  /**
   * What this person will be doing on the boat (ADR 20261007-participant-types).
   * Absent is a diver. A snorkeler or a rider is asked for no card at all —
   * there is no dive for a certification to qualify — so the requirement this
   * gate composes for them is empty, and it admits. Readiness composes the same
   * empty requirement (`calculateReadiness`), which is what keeps the rule that
   * admission never refuses someone readiness would clear.
   */
  participantType?: ParticipantType;
};

/**
 * The one place a booking decides whether a trip's cert gates make the seat
 * impossible. Every booking door reaches it through `createBookingRecord`
 * (src/db/bookings.ts), never by re-implementing it.
 */
export function decideTripAdmission(input: TripAdmissionInput): TripAdmission {
  // A course session's admission rule is the course's own, checked upstream —
  // see `TripAdmissionInput.courseSession`. Ahead of everything else because
  // it is a statement about *which rule applies*, not an exemption from this
  // one.
  if (input.courseSession) return ADMITTED;
  // Not diving, so nothing a card qualifies is being bought. A course session
  // never reaches here with one (`createBookingRecord` refuses it first).
  if (!isDiver(input.participantType)) return ADMITTED;

  // The trip's own requirement and every site it visits, folded together — the
  // strictest level, the union of specialties, nitrox if either wants it. A
  // missing requirement row is not "no gate": a trip with no row of its own
  // still inherits whatever its dive sites demand.
  const effective = unionRequirements(input.requirement, input.siteRequirement);
  if (requirementDemandsNothing(effective)) return ADMITTED;

  // Deliberate, and not the inversion it looks like (security review
  // 2026-09-11 read this as "the weaker door skips the stricter gate"). The
  // flag means this seat attached itself to an existing person on a guess
  // (H-20260724-one-person-per-email), so that person's cards are evidence about *somebody* and not
  // provably about the booker — `tripAdmissionFor` does not even read them,
  // and this line makes the same answer explicit rather than leaving it to
  // fall out of an empty evidence set. Admitting is therefore H-20260724-certification-levels-agency-rules's ordinary
  // fail-open on absence of evidence, not an exemption from the gate.
  //
  // What re-decides: `calculateReadiness` raises `identity_unconfirmed` for
  // the same booking (src/lib/readiness.ts) and fails closed on it, so the
  // seat cannot board until a staffer confirms it is the same human — and
  // once they do, the cards are read here on the claimant's own record
  // (src/features/seat-claims/store.ts) or by readiness at the rail. The roster withholds
  // that person's details until the same confirmation (`RosterSection.tsx`).
  if (input.identityUnconfirmed) return ADMITTED;

  // **Before the boat, a stated card is taken at its word** (H-20260803-booking-time-trip-admission/H-20260820-shophasadjudicated-src-lib-trip, product
  // owner 2026-08-20). Everything on the record is evidence here — staff-typed,
  // imported, or the diver's own declaration — because the question this gate
  // asks is "could this diver ever be cleared?", and a diver who says they hold
  // Advanced and gives a number to check has answered it. Readiness is where the
  // word has to become a sighting; nothing below weakens that, and
  // `certificationBlocker` still clears on `verified` alone.
  //
  // This gate is therefore **not** an enforcement boundary and must never be
  // read as one — a diver who wanted past it could always type a different rung.
  // What it buys is that the refusal arrives *at the sale*, naming what the trip
  // needs, instead of at the dock with a seat already paid for.
  const evidence = input.evidence;
  const certifications = evidence.certifications;
  const specialtyCertifications = evidence.specialtyCertifications;
  const nitroxCertifications = evidence.nitroxCertifications;
  const declaredLevel = input.declared?.level ?? null;
  const declaredNitrox = Boolean(input.declared?.nitrox);
  // Saying something is being known. A diver who names their rung on the form
  // has stopped being the stranger H-20260724-certification-levels-agency-rules admits blind, and is judged on their own
  // words like anyone else.
  if (!shopHasAdjudicated(certifications) && !declaredLevel && !declaredNitrox) return ADMITTED;

  // The ladder at the sale threshold (`standing` in src/lib/readiness.ts): the
  // same reading of the same rows that decides boarding, with the bar at "a
  // row in any state, or the sentence they just typed". The strongest thing said
  // about this diver, from any direction, is what stops a stale Open Water row
  // refusing somebody who has since qualified and says so.
  const sale: StandingEvidence = {
    certifications,
    specialtyCertifications,
    nitroxCertifications,
    declaredLevel,
    declaredNitrox,
    levelsInTraining: evidence.levelsInTraining,
  };
  const blockers = standing(effective, sale, "sale");
  // A course seat a staff mark could make this a training dive for, with the
  // course's instructor aboard, is a level readiness would clear on (#2731):
  // the level blocker goes, and a specialty or nitrox one still stands. Only a
  // site's level is lowered, exactly as readiness lowers it: a level the trip
  // itself sets stands at the sale as it stands at the rail (issue #3776).
  // A default level nobody chose counts as the site's here too
  // (`tripAndSiteSides`, issue #3872). On a charter of two or more dives only
  // the default is lowered (`trainingDiveReach`, issue #3910).
  const markWouldClear =
    effective.minimumCertificationLevel !== null &&
    (evidence.trainingDives ?? []).some((course) => {
      const marked = markedTrainingRequirement(
        input.requirement,
        input.siteRequirement,
        course,
        evidence.trainingDiveReach ?? "site",
      ).minimumCertificationLevel;
      return marked === null || levelStanding(marked, sale, "sale") === null;
    });
  const refusal = markWouldClear
    ? blockers.filter((blocker) => !blocker.code.startsWith("certification_"))
    : blockers;
  return refusal.length === 0 ? ADMITTED : { admitted: false, refusal };
}

/**
 * Every value a refusal's params can hold, as a runtime set. Written as an
 * exhaustive `Record` rather than an array so adding a rung or a specialty is a
 * type error here: a code the decoder silently rejects would turn a specific
 * refusal notice into a blank one at the worst possible moment.
 */
const LEVEL_CODES: Record<CertificationLevel, true> = {
  open_water: true,
  advanced_open_water: true,
  rescue: true,
  divemaster: true,
  instructor: true,
};

const SPECIALTY_CODES: Record<DiveSpecialty, true> = {
  deep: true,
  wreck: true,
  night: true,
  drysuit: true,
  cavern: true,
};

/**
 * The four blockers the sale threshold can raise, each with the params it
 * carries in order and its place on the ladder. Anything else on the wire was
 * not written by `encodeTripAdmissionRefusal`.
 */
const REFUSAL_CODES = {
  certification_insufficient: { rank: 0, params: ["requiredLevel", "heldLevel"] },
  certification_missing: { rank: 0, params: ["requiredLevel"] },
  specialty_missing: { rank: 1, params: ["specialty"] },
  nitrox_missing: { rank: 2, params: [] },
} as const satisfies Partial<
  Record<
    ReadinessBlocker["code"],
    { rank: number; params: readonly ("requiredLevel" | "heldLevel" | "specialty")[] }
  >
>;

type RefusalCode = keyof typeof REFUSAL_CODES;

/** Between blockers: unreserved in a URI, and in no code or param. */
const BLOCKER = "~";
/** Between a blocker's code and its params, for the same reason. */
const PARAM = "-";

/**
 * The refusal, flattened into **one** query-param value: each blocker as its
 * code and params, in ladder order.
 *
 * A staff seating is a server action that redirects back to the door that
 * submitted it, so the only channel a refusal has to the page that must explain
 * it is the URL. Without this the structured detail died in `seatDiver` and
 * every surface rendered one static sentence that could not tell "your Deep
 * card isn't on file" from "you are not an Advanced diver".
 *
 * Codes, never words: these are readiness's own blocker codes, and `src/i18n`
 * picks the sentence. Staff-only by construction (every consumer sits behind
 * `/shop/**`), and it says nothing the staffer reading it cannot already open
 * the diver's record and see.
 *
 * **This is the codec, not the credential.** Nothing here proves the refusal
 * ever happened, so no surface reads a `?gate=` through this function directly:
 * `src/lib/trip-admission-gate.ts` wraps it in an HMAC bound to the departure
 * (or the diver) whose page will render it, and that is what the banners call.
 */
export function encodeTripAdmissionRefusal(refusal: TripAdmissionRefusal): string {
  return refusal
    .map((blocker) => {
      const shape = REFUSAL_CODES[blocker.code as RefusalCode];
      const params = shape ? shape.params.map((name) => blocker.params?.[name] ?? "") : [];
      return [blocker.code, ...params].join(PARAM);
    })
    .join(BLOCKER);
}

function decodeBlocker(item: string): ReadinessBlocker | null {
  const [code, ...values] = item.split(PARAM);
  if (!code || !Object.hasOwn(REFUSAL_CODES, code)) return null;
  const shape = REFUSAL_CODES[code as RefusalCode];
  if (values.length !== shape.params.length) return null;
  const params: NonNullable<ReadinessBlocker["params"]> = {};
  for (const [index, name] of shape.params.entries()) {
    // `values` is exactly `shape.params` long: checked above.
    const value = values[index] as string;
    if (name === "specialty") {
      if (!Object.hasOwn(SPECIALTY_CODES, value)) return null;
      params.specialty = value as DiveSpecialty;
    } else {
      if (!Object.hasOwn(LEVEL_CODES, value)) return null;
      params[name] = value as CertificationLevel;
    }
  }
  // The sale only says "holds {held}, needs {required}" when held is below it.
  if (
    params.requiredLevel &&
    params.heldLevel &&
    certificationRank(params.heldLevel) >= certificationRank(params.requiredLevel)
  ) {
    return null;
  }
  return shape.params.length > 0
    ? { code: code as RefusalCode, params }
    : { code: code as RefusalCode };
}

/**
 * The inverse, over an attacker-supplied query string: anything that is not
 * exactly what `encodeTripAdmissionRefusal` writes for a refusal
 * `decideTripAdmission` could return is null, and the caller falls back to the
 * generic notice. Unknown codes are rejected rather than dropped, because a
 * half-decoded refusal would state a requirement the trip does not have; so is
 * a list out of ladder order, a second level blocker or a repeated specialty.
 *
 * **`string[]` is a shape Next really delivers**, not a defensive flourish:
 * `?gate=a&gate=b` arrives as an array, and an `if (!value)` lets one through
 * (an array is truthy) straight into `value.split()`: a `TypeError` and a 500
 * on a staff page, from a query param. Same class `src/proxy.ts` documents for
 * `embed`. Hardened here rather than at each reader so every call site
 * inherits it.
 */
export function decodeTripAdmissionRefusal(
  value: string | readonly string[] | undefined | null,
): TripAdmissionRefusal | null {
  if (typeof value !== "string" || !value) return null;
  const refusal: ReadinessBlocker[] = [];
  let lastRank = -1;
  const specialties = new Set<string>();
  for (const item of value.split(BLOCKER)) {
    const blocker = decodeBlocker(item);
    if (!blocker) return null;
    const rank = REFUSAL_CODES[blocker.code as RefusalCode].rank;
    // Level, then specialties, then nitrox; only specialties repeat, each once.
    if (rank < lastRank || (rank === lastRank && rank !== 1)) return null;
    if (blocker.params?.specialty) {
      if (specialties.has(blocker.params.specialty)) return null;
      specialties.add(blocker.params.specialty);
    }
    lastRank = rank;
    refusal.push(blocker);
  }
  return refusal;
}
