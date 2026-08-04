import type { DiveSpecialty } from "@/db/schema";
import type {
  CertificationLevel,
  ReadinessBlocker,
  ReadinessBlockerCode,
  ReadinessStatus,
} from "@/lib/readiness";
import type { TripAdmissionRefusal } from "@/lib/trip-admission";
import type { DiverMessageKey, DiverTranslator } from "./messages";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **Blocked / Ready — the shop's one readiness vocabulary.**
 *
 * The same `status` boolean used to render as four different things: "Needs
 * attention" on the roster and the check-in queue, "Blocked" on the manifest
 * and the departure board, "can't board yet" in the Not ready copy — and in
 * two different tones, warning at the counter but danger on the roster. A
 * staffer reading the counter queue and the manifest for the same diver saw two
 * words and two colours for one fact, and nothing on either screen said they
 * meant the same thing.
 *
 * So the word and the tone both resolve from here. "Blocked" wins because it is
 * what the manifest — the surface that decides whether a person boards — and
 * the nav badge already say. Danger wins for the same reason: a diver who
 * cannot board is not a warning on one screen and an emergency on another.
 *
 * "Not ready" survives only as the name of a *view* (the by-departure lens on
 * Today), never as a row's status.
 */
export const READINESS_STATUS_KEYS: Record<ReadinessStatus, StaffMessageKey> = {
  ready: "shared.readiness.status.ready",
  blocked: "shared.readiness.status.blocked",
};

/** The one word a readiness status goes by, in the staff bundle's language. */
export function readinessStatusText(t: StaffTranslator, status: ReadinessStatus): string {
  return t(READINESS_STATUS_KEYS[status]);
}

/**
 * The one tone a readiness status wears. Colour never carries the meaning on
 * its own (design/principles.md #6) — it only has to stop contradicting the
 * word beside it from one screen to the next.
 */
export function readinessStatusTone(status: ReadinessStatus): "success" | "danger" {
  return status === "ready" ? "success" : "danger";
}

/**
 * `readiness.ts` returns a certification-level or specialty *code*; this maps
 * each one to where its word lives in the staff bundle. Kept beside the
 * blocker-code map below so a new `CertificationLevel`/`DiveSpecialty` value
 * is a type error here, not silent English on a badge somewhere.
 */
export const CERTIFICATION_LEVEL_KEYS: Record<CertificationLevel, StaffMessageKey> = {
  open_water: "shared.readiness.certificationLevels.openWater",
  advanced_open_water: "shared.readiness.certificationLevels.advancedOpenWater",
  rescue: "shared.readiness.certificationLevels.rescue",
  divemaster: "shared.readiness.certificationLevels.divemaster",
  instructor: "shared.readiness.certificationLevels.instructor",
};

/**
 * The one diver-facing consumer (the public course page, `course.*`
 * namespace) — kept separate from the staff-facing map above rather than
 * shared, per the "never let one src/lib function pick a single bundle"
 * rule: this key set is only ever looked up with a `DiverTranslator`.
 */
export const DIVER_CERTIFICATION_LEVEL_KEYS: Record<CertificationLevel, DiverMessageKey> = {
  open_water: "course.certificationLevels.openWater",
  advanced_open_water: "course.certificationLevels.advancedOpenWater",
  rescue: "course.certificationLevels.rescue",
  divemaster: "course.certificationLevels.divemaster",
  instructor: "course.certificationLevels.instructor",
};

export const SPECIALTY_KEYS: Record<DiveSpecialty, StaffMessageKey> = {
  deep: "shared.readiness.specialties.deep",
  wreck: "shared.readiness.specialties.wreck",
  night: "shared.readiness.specialties.night",
  drysuit: "shared.readiness.specialties.drysuit",
};

/** The diver-facing half, on the same terms as `DIVER_CERTIFICATION_LEVEL_KEYS` above. */
export const DIVER_SPECIALTY_KEYS: Record<DiveSpecialty, DiverMessageKey> = {
  deep: "trip.specialties.deep",
  wreck: "trip.specialties.wreck",
  night: "trip.specialties.night",
  drysuit: "trip.specialties.drysuit",
};

/**
 * **What a trip asks of anybody**, as one diver-facing phrase — never what a
 * particular diver holds.
 *
 * This is a property of the *trip*: the same words for every reader, disclosing
 * nothing about any person, so it is safe on a public page and safe in a
 * refusal to an anonymous submitter (H-22 — the public form must never describe
 * the person behind a typed email). It is the honest replacement for the trip
 * page's old silence, where the requirement was passed only into
 * `BookingConfirmation` — i.e. shown for the first time *after* the seat was
 * bought — and for the refusal that told a diver looking at "4 spots left" that
 * the trip "isn't taking bookings right now".
 *
 * Null when the trip demands nothing, so callers render nothing rather than an
 * empty sentence.
 */
export function tripRequirementList(
  t: DiverTranslator,
  requirement: {
    minimumCertificationLevel: CertificationLevel | null;
    requiredSpecialties: readonly DiveSpecialty[];
    requiresNitrox: boolean;
  },
  locale: string,
): string | null {
  const parts = [
    requirement.minimumCertificationLevel
      ? t("trip.requirementLevel", {
          level: t(DIVER_CERTIFICATION_LEVEL_KEYS[requirement.minimumCertificationLevel]),
        })
      : null,
    ...requirement.requiredSpecialties.map((specialty) =>
      t("trip.requirementSpecialty", { specialty: t(DIVER_SPECIALTY_KEYS[specialty]) }),
    ),
    requirement.requiresNitrox ? t("trip.requirementNitrox") : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  // A locale-appropriate "X, Y and Z" — never an English comma join.
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(parts);
}

/** Every `ReadinessBlockerCode` the engine can raise, to its staff-facing sentence. */
const READINESS_BLOCKER_KEYS: Record<ReadinessBlockerCode, StaffMessageKey> = {
  requirements_not_configured: "shared.readiness.blockers.requirementsNotConfigured",
  identity_unconfirmed: "shared.readiness.blockers.identityUnconfirmed",
  waiver_not_sent: "shared.readiness.blockers.waiverNotSent",
  waiver_pending: "shared.readiness.blockers.waiverPending",
  waiver_expired: "shared.readiness.blockers.waiverExpired",
  medical_review: "shared.readiness.blockers.medicalReview",
  certification_missing: "shared.readiness.blockers.certificationMissing",
  certification_pending: "shared.readiness.blockers.certificationPending",
  certification_expired: "shared.readiness.blockers.certificationExpired",
  certification_insufficient: "shared.readiness.blockers.certificationInsufficient",
  specialty_missing: "shared.readiness.blockers.specialtyMissing",
  specialty_pending: "shared.readiness.blockers.specialtyPending",
  specialty_expired: "shared.readiness.blockers.specialtyExpired",
  specialty_import_unconfirmed: "shared.readiness.blockers.specialtyImportUnconfirmed",
  nitrox_missing: "shared.readiness.blockers.nitroxMissing",
  nitrox_pending: "shared.readiness.blockers.nitroxPending",
  under_minimum_age: "shared.readiness.blockers.underMinimumAge",
  payment_due: "shared.readiness.blockers.paymentDue",
  payment_refunded: "shared.readiness.blockers.paymentRefunded",
  readiness_unavailable: "shared.readiness.blockers.readinessUnavailable",
};

/**
 * The one sentence a `ReadinessBlocker` renders as, in the staff bundle's
 * language. Resolves `params.requiredLevel`/`params.specialty` through their
 * own label keys first, so a translator only ever fills a single placeholder
 * with an already-translated word — never a raw domain code.
 */
export function readinessBlockerText(t: StaffTranslator, blocker: ReadinessBlocker): string {
  const key = READINESS_BLOCKER_KEYS[blocker.code];
  const params = blocker.params;
  if (params?.requiredLevel) {
    return t(key, { level: t(CERTIFICATION_LEVEL_KEYS[params.requiredLevel]) });
  }
  if (params?.specialty) {
    return t(key, { specialty: t(SPECIALTY_KEYS[params.specialty]) });
  }
  if (params?.age !== undefined && params.minimumAge !== undefined) {
    return t(key, { age: params.age, minimumAge: params.minimumAge });
  }
  return t(key);
}

/**
 * **The words a refused sale gets, driven by which requirement actually
 * failed** (`TripAdmissionRefusal`, src/lib/trip-admission.ts).
 *
 * One sentence used to cover every case: *"…don't reach what that trip and its
 * dive sites require. Add the missing card above…"*. On a **level** refusal
 * that is false and unsafe at once — an Open Water diver refused an
 * Advanced-only charter has no missing card, and telling a staffer to add one
 * points them at the certifications form as the way past a safety gate. A
 * hand-entered card lands `pending`, and a `pending` card at or above the bar
 * clears admission on the very next attempt: a one-minute in-UI path from
 * refused to seated, asserting nothing (H-24, glossary **Card sighting**).
 *
 * So the two cases are told apart:
 *
 * - **Level** — name the requirement *and* what the diver holds, so a wrong
 *   record is visible, and make "add a card" conditional on their actually
 *   holding one. The real remedies are a trip at their level or the course.
 * - **Specialty / nitrox** — here "add the card" genuinely is right: a
 *   specialty is a card the shop may simply never have captured.
 *
 * Both may fire at once, in which case both sentences render.
 */
export function tripAdmissionRefusalText(
  t: StaffTranslator,
  refusal: TripAdmissionRefusal,
  locale: string,
): string {
  const sentences: string[] = [];
  if (refusal.requiredLevel) {
    const level = t(CERTIFICATION_LEVEL_KEYS[refusal.requiredLevel]);
    sentences.push(
      refusal.heldLevel
        ? t("shared.tripAdmission.level", {
            level,
            held: t(CERTIFICATION_LEVEL_KEYS[refusal.heldLevel]),
          })
        : t("shared.tripAdmission.levelNoCard", { level }),
    );
  }
  // Nitrox rides in the same list as the specialties: to a staffer reading a
  // refusal they are the same kind of thing — a card that is or isn't on the
  // record — even though the domain models them in separate tables.
  const cards = [
    ...refusal.missingSpecialties.map((specialty) => t(SPECIALTY_KEYS[specialty])),
    ...(refusal.nitroxRequired ? [t("shared.tripAdmission.nitrox")] : []),
  ];
  if (cards.length > 0) {
    sentences.push(
      t("shared.tripAdmission.cards", {
        count: cards.length,
        // A locale-appropriate "X, Y and Z", never an English comma join.
        list: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(cards),
      }),
    );
  }
  // Nothing set is not a refusal `decideTripAdmission` can produce; the generic
  // sentence is the honest fallback rather than an empty banner.
  return sentences.length > 0 ? sentences.join(" ") : t("shared.tripAdmission.generic");
}
