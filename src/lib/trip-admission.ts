import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  SpecialtyCertification,
} from "@/db/schema";
import {
  type CertificationLevel,
  type CertRequirementSource,
  certificationRank,
  combineCertRequirements,
  type SiteCertRequirement,
} from "./readiness";

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
 * card captured but not yet verified, a refresher that has come due, a payment
 * outstanding — is *not* a reason to refuse the sale. Only a settled
 * impossibility is.
 *
 * **Absence of evidence is never a refusal.** A shop that has never carded this
 * diver knows nothing about them, and refusing there would lock out every new
 * customer and every diver whose cards predate this rule shipping. That is the
 * same trade-off the product owner already settled for the course minimum-age
 * gate (docs/product/human-decisions.md H-08: "collect a date of birth, fail
 * open"; the fail-closed option was declined for exactly this blast radius),
 * and this rule follows it rather than inventing a second policy. Readiness and
 * the dock still hold that line — nothing here weakens them.
 *
 * Note what is deliberately *not* consulted: expiry and verification status.
 * Both are states a diver or a staffer can move before departure (the stored
 * "expiry" is a shop-set refresher-due date, not a card expiry — see the
 * glossary's C-card entry), so neither can make a seat impossible. What cannot
 * be moved by paperwork is the rung of the ladder a diver stands on and whether
 * they hold a specialty card at all.
 *
 * **Why ignoring `status` is safe, and what would make it unsafe.** A `pending`
 * card is not a self-assertion: **divers cannot write cards.** The only callers
 * of `createCertification` / `createSpecialtyCertification` /
 * `createNitroxCertification` are the authenticated staff surface
 * `src/app/shop/[shopSlug]/divers/[personId]/actions.ts` and the staff-run
 * contact importer, so every row this function reads is a staffer's
 * transcription of something they were handed. `pending` means "a staffer typed
 * it, nobody has looked the number up with the agency yet" — a queue state, not
 * a claim by the person taking the seat. Readiness is what waits for the
 * lookup.
 *
 * That is load-bearing. **A diver-facing "add your card" form would turn this
 * gate into self-attestation**: a refused diver could type the level the boat
 * demands and be admitted on the next attempt, having asserted nothing — the
 * leak H-24 exists to prevent. If a card ever becomes diver-writable, this
 * function must start reading `status` (or the origin of the row) in the same
 * change.
 */

/** The diver's certification evidence at this shop, as the db layer hands it up. */
export type TripAdmissionEvidence = {
  certifications: readonly Certification[];
  specialtyCertifications: readonly SpecialtyCertification[];
  nitroxCertifications: readonly NitroxCertification[];
};

/**
 * Why the sale was refused, as data rather than a sentence (`src/lib` returns
 * codes — docs ADR 20260731-domain-layer-copy-leaks). Between them these four
 * fields say *which* requirement failed and *what the diver holds*, which is
 * what a staffer needs to act: capture the missing card, or put the diver on a
 * trip they can actually dive.
 */
export type TripAdmissionRefusal = {
  /** Demanded by the trip or one of its sites, and above everything on file. Null when the level was met. */
  requiredLevel: CertificationLevel | null;
  /** Specialties demanded with no card of that specialty on file at all. */
  missingSpecialties: DiveSpecialty[];
  /** Nitrox demanded with no enriched-air card on file at all. */
  nitroxRequired: boolean;
  /**
   * The highest rung anything in this diver's record reaches, whatever its
   * status or refresher date — the honest complement of "nothing on file
   * reaches {requiredLevel}". Null only when the refusal is about a specialty
   * or nitrox card rather than the ladder.
   */
  heldLevel: CertificationLevel | null;
};

export type TripAdmission = { admitted: true } | { admitted: false; refusal: TripAdmissionRefusal };

const ADMITTED: TripAdmission = { admitted: true };

/** Demands nothing of anybody — the stand-in for a trip with no requirement row of its own. */
const NO_TRIP_REQUIREMENT: CertRequirementSource = {
  minimumCertificationLevel: null,
  requiredSpecialties: [],
  requiresNitrox: false,
};

/**
 * The highest rung any certification on file reaches, ignoring status and
 * refresher date entirely: a pending capture and an overdue card are both still
 * evidence of what this diver was trained to do, and neither is something a
 * booking should refuse over.
 */
function highestLevelOnFile(certifications: readonly Certification[]): CertificationLevel | null {
  let best: CertificationLevel | null = null;
  for (const certification of certifications) {
    if (!best || certificationRank(certification.level) > certificationRank(best)) {
      best = certification.level;
    }
  }
  return best;
}

/**
 * Has this shop adjudicated this diver's cards at all? One verified
 * certification is the marker: it means a staffer looked the card number up
 * with the issuing agency and recorded the answer (glossary, **Verified
 * certification**), so the record can be relied on for what this diver holds.
 * Expiry is irrelevant to the question — a card that has since come due for a
 * refresher was still adjudicated.
 *
 * Without one, this diver is simply unknown to the shop, and an unknown diver
 * is admitted (see the module docstring).
 */
function shopHasAdjudicated(certifications: readonly Certification[]): boolean {
  return certifications.some((certification) => certification.status === "verified");
}

export type TripAdmissionInput = {
  /** The trip's own requirement row, or null when the shop hasn't configured one. */
  requirement: CertRequirementSource | null;
  /** Every dive site the trip visits, already folded into one gate (`combineSiteRequirements`). */
  siteRequirement: SiteCertRequirement | null;
  evidence: TripAdmissionEvidence;
  /**
   * The booking reused an existing person by email under a name that didn't
   * match (H-13). The certs on that record are then evidence about *someone*,
   * but not provably about the person booking, so they are not read at all and
   * the seat is admitted — readiness already fails closed on the same flag, and
   * judging a possible second human by the first one's cards would be wrong in
   * both directions.
   */
  identityUnconfirmed?: boolean;
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

  // The trip's own requirement and every site it visits, folded together — the
  // strictest level, the union of specialties, nitrox if either wants it. A
  // missing requirement row is not "no gate": a trip with no row of its own
  // still inherits whatever its dive sites demand.
  const effective = combineCertRequirements(
    input.requirement ?? NO_TRIP_REQUIREMENT,
    input.siteRequirement,
  );
  if (
    !effective.minimumCertificationLevel &&
    effective.requiredSpecialties.length === 0 &&
    !effective.requiresNitrox
  ) {
    return ADMITTED;
  }

  if (input.identityUnconfirmed) return ADMITTED;
  const { certifications, specialtyCertifications, nitroxCertifications } = input.evidence;
  if (!shopHasAdjudicated(certifications)) return ADMITTED;

  const heldLevel = highestLevelOnFile(certifications);
  const requiredLevel =
    effective.minimumCertificationLevel &&
    (!heldLevel ||
      certificationRank(heldLevel) < certificationRank(effective.minimumCertificationLevel))
      ? effective.minimumCertificationLevel
      : null;

  // A card of the right specialty in *any* state clears admission — pending
  // review, imported and awaiting a staffer's one-tap confirm, or overdue for a
  // refresher are all things that move before departure. Only a diver with no
  // such card at all cannot dive this site.
  const missingSpecialties = effective.requiredSpecialties.filter(
    (specialty) => !specialtyCertifications.some((card) => card.specialty === specialty),
  );

  const nitroxRequired = effective.requiresNitrox && nitroxCertifications.length === 0;

  if (!requiredLevel && missingSpecialties.length === 0 && !nitroxRequired) return ADMITTED;
  return {
    admitted: false,
    refusal: {
      requiredLevel,
      missingSpecialties,
      nitroxRequired,
      // Only meaningful alongside a level refusal; a diver refused purely for a
      // missing Deep card is not being told their ladder rung is the problem.
      heldLevel: requiredLevel ? heldLevel : null,
    },
  };
}

/**
 * Every code either half of the refusal can hold, as a runtime set. Written as
 * an exhaustive `Record` rather than an array so adding a rung or a specialty
 * is a type error here — a code the decoder silently rejects would turn a
 * specific refusal notice into a blank one at the worst possible moment.
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
};

/** Field separator in the encoded value — unreserved in a URI, and in no code. */
const FIELD = "~";
/** Separator inside the specialty list, for the same reason. */
const ITEM = "-";

/**
 * The refusal, flattened into **one** query-param value.
 *
 * A staff seating is a server action that redirects back to the door that
 * submitted it, so the only channel a refusal has to the page that must explain
 * it is the URL. Without this the structured detail — the ADR's whole
 * justification for carrying `{requiredLevel, missingSpecialties,
 * nitroxRequired, heldLevel}` at all — died in `seatDiver` and every surface
 * rendered one static sentence that could not tell "your Deep card isn't on
 * file" from "you are not an Advanced diver".
 *
 * Codes, never words: this is the same domain vocabulary readiness puts on the
 * wire, and `src/i18n` picks the sentence. Staff-only by construction — every
 * consumer sits behind `/shop/**` — and it says nothing the staffer reading it
 * cannot already open the diver's record and see.
 *
 * **This is the codec, not the credential.** Nothing here proves the refusal
 * ever happened, so no surface reads a `?gate=` through this function directly:
 * `src/lib/trip-admission-gate.ts` wraps it in an HMAC bound to the departure
 * (or the diver) whose page will render it, and that is what the banners call.
 */
export function encodeTripAdmissionRefusal(refusal: TripAdmissionRefusal): string {
  return [
    refusal.requiredLevel ?? "",
    refusal.heldLevel ?? "",
    refusal.missingSpecialties.join(ITEM),
    refusal.nitroxRequired ? "1" : "0",
  ].join(FIELD);
}

/**
 * The inverse, over an attacker-supplied query string: anything that is not
 * exactly what `encodeTripAdmissionRefusal` writes returns null, and the caller
 * falls back to the generic notice. Unknown codes are rejected rather than
 * dropped, because a half-decoded refusal would state a requirement the trip
 * does not have.
 *
 * **`string[]` is a shape Next really delivers**, not a defensive flourish:
 * `?gate=a&gate=b` arrives as an array, and the old `if (!value)` let one
 * through (an array is truthy) straight into `value.split()` — a `TypeError`
 * and a 500 on a staff page, from a query param. Same class `src/proxy.ts`
 * documents for `embed`. Hardened here rather than at each reader so every
 * call site inherits it.
 */
export function decodeTripAdmissionRefusal(
  value: string | readonly string[] | undefined | null,
): TripAdmissionRefusal | null {
  if (typeof value !== "string" || !value) return null;
  const parts = value.split(FIELD);
  if (parts.length !== 4) return null;
  const [required, held, specialties, nitrox] = parts as [string, string, string, string];
  if (required && !Object.hasOwn(LEVEL_CODES, required)) return null;
  if (held && !Object.hasOwn(LEVEL_CODES, held)) return null;
  if (nitrox !== "0" && nitrox !== "1") return null;
  const missingSpecialties = specialties ? specialties.split(ITEM) : [];
  if (missingSpecialties.some((specialty) => !Object.hasOwn(SPECIALTY_CODES, specialty))) {
    return null;
  }
  const refusal: TripAdmissionRefusal = {
    requiredLevel: (required || null) as CertificationLevel | null,
    heldLevel: (held || null) as CertificationLevel | null,
    missingSpecialties: missingSpecialties as DiveSpecialty[],
    nitroxRequired: nitrox === "1",
  };
  // A refusal that demands nothing is not a refusal this function produced.
  if (
    !refusal.requiredLevel &&
    refusal.missingSpecialties.length === 0 &&
    !refusal.nitroxRequired
  ) {
    return null;
  }
  return refusal;
}
