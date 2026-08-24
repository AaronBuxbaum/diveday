import type { CertificationAgency, DiveSpecialty } from "@/db/schema";
import type { DiveRecencyBand } from "@/lib/dive-recency";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  type CertificationLevel,
  REQUIRABLE_CERTIFICATION_LEVELS,
  type ReadinessBlocker,
  type ReadinessBlockerCode,
  type ReadinessStatus,
  type RequirableCertificationLevel,
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
 * **The levels a requirement picker offers**, in the order the ladder runs.
 *
 * Built from `REQUIRABLE_CERTIFICATION_LEVELS` rather than by filtering
 * `CERTIFICATION_LEVEL_KEYS` at the two `<select>`s, so "what a shop may demand"
 * has one answer and it is the domain layer's (`src/lib/readiness.ts`). The map
 * above stays whole because a *held* Divemaster card still has to render.
 */
export const REQUIRABLE_CERTIFICATION_LEVEL_KEYS: readonly (readonly [
  RequirableCertificationLevel,
  StaffMessageKey,
])[] = REQUIRABLE_CERTIFICATION_LEVELS.map(
  (level) => [level, CERTIFICATION_LEVEL_KEYS[level]] as const,
);

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

/**
 * **What a list joiner can dive, in one staff-facing phrase** — for the
 * last-minute-deal recipient preview and the wait-list rows, where a staffer
 * decides who to mail.
 *
 * Four shapes, and the differences between them are the feature:
 *
 * - Nothing on file → *"Level not said"*. Stated, never a blank: a gap on a row
 *   reads as a rendering bug, and "we don't know" is the honest and common
 *   answer on a marketing opt-in that asks optionally.
 * - The diver said they hold no card → *"Not certified yet — diver's word"*.
 *   The shape that was missing until 2026-08-15, and the reason it mattered:
 *   an uncertified joiner had to pick "Rather not say", which rendered as the
 *   line above and is what a certified regular who skipped the question gets —
 *   so the shop read a clean list and mailed a Discover Scuba customer a
 *   certified two-tank charter.
 * - A card the shop holds → the level, plainly.
 * - A claim nobody has checked → the level, **marked self-declared**. This is
 *   the string that stops the bad email (FU-20260813). It never gates anything;
 *   a shop that can see it simply does not send an Open Water diver a deep
 *   wreck deal.
 *
 * Nitrox rides in the same phrase and carries its own mark, because the two can
 * differ — a diver whose level card the shop verified may still only have
 * *claimed* enriched air.
 *
 * **Not a "dive profile".** To a diver that phrase is the depth/time curve of a
 * dive they made, and this is the opposite thing — what they may dive, before
 * anybody gets wet. The type, the reader and both message namespaces were
 * renamed off it on 2026-08-15 (ADR 20260814-self-declared-cards); nothing
 * user-visible ever said it, which is why the fix is a rename and not a copy
 * change.
 */
export type CertificationSummaryShape = {
  level: CertificationLevel | null;
  levelSelfDeclared: boolean;
  /**
   * The joiner said they hold no card at all — *"Not certified yet — diver's
   * word"* rather than the identical-looking silence of somebody who skipped an
   * optional question. It is a fourth shape and the reason the column exists: a
   * shop reading "Level not said" mails a Discover Scuba customer a certified
   * two-tank charter.
   */
  noCertificationDeclared: boolean;
  nitrox: boolean;
  nitroxSelfDeclared: boolean;
};

/**
 * **Whether the phrase above is carrying somebody's word for it**, so the row
 * rendering it can wear the tone that says so.
 *
 * The mark used to be the only difference between a claim and a card the shop
 * holds, and it sat in muted text at the *end* of the line — which on a
 * phone-width row is the first thing to truncate. The product's own precedent
 * for "on file, but the gate is not open" is the imported specialty card's
 * warning-toned badge (`heldCardStatusTone`), and this is a weaker fact than
 * that one: nobody has seen anything at all.
 */
export function certificationSummaryUnchecked(summary: CertificationSummaryShape | null): boolean {
  if (!summary) return false;
  return (
    (summary.level !== null && summary.levelSelfDeclared) ||
    // "Not certified yet" is the diver's word too, and it is the row a staffer
    // most needs to catch before a two-tank charter goes out to it. It only
    // reads that way while no level has landed beside it — the phrase below
    // draws the level instead once one has, and the tone must not contradict
    // the words it is colouring.
    (summary.level === null && summary.noCertificationDeclared) ||
    (summary.nitrox && summary.nitroxSelfDeclared)
  );
}

export function certificationSummaryText(
  t: StaffTranslator,
  summary: CertificationSummaryShape | null,
  locale: string,
): string {
  const parts: string[] = [];
  if (!summary?.level) {
    // Three ways to have no level, and only two of them are the same thing. A
    // stated "I hold no card" outranks the silence of a skipped question; a
    // level of *either* provenance outranks the stamp, because it is the later
    // and more specific statement (the stamp is ignored, never deleted — ADR
    // 20260814-self-declared-cards).
    parts.push(
      summary?.noCertificationDeclared
        ? t("shared.certificationSummary.notCertified")
        : t("shared.certificationSummary.levelNotSaid"),
    );
  } else {
    const level = t(CERTIFICATION_LEVEL_KEYS[summary.level]);
    parts.push(
      summary.levelSelfDeclared
        ? t("shared.certificationSummary.selfDeclared", { value: level })
        : level,
    );
  }
  if (summary?.nitrox) {
    const nitrox = t("shared.certificationSummary.nitrox");
    parts.push(
      summary.nitroxSelfDeclared
        ? t("shared.certificationSummary.selfDeclared", { value: nitrox })
        : nitrox,
    );
  }
  // A locale-appropriate "X and Y", never an English comma join.
  return cachedListFormat(locale, { style: "long", type: "unit" }).format(parts);
}

/**
 * **The same phrase, saying on the row that this diver ranks below what the
 * departure asks for.**
 *
 * A sibling rather than a parameter on {@link certificationSummaryText}, and
 * deliberately: only a caller that already holds a departure's effective
 * minimum can honestly say this, so the shared phrase stays sayable by a caller
 * that does not. Two callers hold one: the last-minute-deal recipient preview
 * (via `reviewLastMinuteRecipients`) and, since 2026-08-15, the wait-list rows
 * on the same page — a DiveDay wait list is per-trip, and an invite is a
 * staffer offering one named person a seat on that exact departure, which is if
 * anything the stronger act of the two. The deal list *reorders* to lift
 * below-the-bar names; the wait list may not, because its order is who asked
 * first (ADR 20260813-wait-list-is-a-lead-list). The mark travels without the
 * ordering.
 *
 * **It is a word, not a colour.** The row's warning tone already means exactly
 * one thing, "nobody has seen this card", and the whole argument for it (ADR
 * 20260814-self-declared-cards, decision 4) collapses the moment a second
 * reason can turn a row warm. So a verified Open Water diver on an Advanced
 * departure — calm, muted, and previously the quietest thing on a screen full
 * of warnings — now *says* he is under the bar, in the one place a scanner is
 * already reading. That leaves tone answering "is this checked?" and words
 * answering "can they board?", which are two different questions and were
 * being carried by one mark (design/principles.md #6).
 *
 * Nothing here filters, reorders, or disables the send. Informing is the design.
 */
export function certificationSummaryBelowRequirementText(
  t: StaffTranslator,
  summary: CertificationSummaryShape | null,
  locale: string,
): string {
  return t("shared.certificationSummary.belowRequirement", {
    value: certificationSummaryText(t, summary, locale),
  });
}

export const SPECIALTY_KEYS: Record<DiveSpecialty, StaffMessageKey> = {
  deep: "shared.readiness.specialties.deep",
  wreck: "shared.readiness.specialties.wreck",
  night: "shared.readiness.specialties.night",
  drysuit: "shared.readiness.specialties.drysuit",
};

/**
 * **How recently a diver has been in the water**, in the diver's own reading
 * language, for the `/ready` question that collects it (ADR
 * 20260821-currency-is-what-catches-people).
 *
 * Bands rather than a date, so the words have to carry the imprecision honestly:
 * "Within the last year" and not "< 12 months", because a diver answering from
 * memory is estimating and the phrasing should say so.
 */
export const DIVER_DIVE_RECENCY_KEYS: Record<DiveRecencyBand, DiverMessageKey> = {
  this_season: "ready.diveRecency.thisSeason",
  within_a_year: "ready.diveRecency.withinAYear",
  one_to_five_years: "ready.diveRecency.oneToFiveYears",
  over_five_years: "ready.diveRecency.overFiveYears",
  never: "ready.diveRecency.never",
};

/**
 * The same five answers as a staffer reads them, on a roster row or a prep list
 * beside a name — shorter, because they sit in a line of other facts rather
 * than in a select the diver is choosing from.
 *
 * Always rendered as the diver's word, never as a fact the shop established.
 * Nothing verifies this and nothing ever will, so a surface that showed it
 * plainly would be claiming an authority it does not have — the same rule the
 * self-declared card mark exists for.
 */
export const STAFF_DIVE_RECENCY_KEYS: Record<DiveRecencyBand, StaffMessageKey> = {
  this_season: "shared.diveRecency.thisSeason",
  within_a_year: "shared.diveRecency.withinAYear",
  one_to_five_years: "shared.diveRecency.oneToFiveYears",
  over_five_years: "shared.diveRecency.overFiveYears",
  never: "shared.diveRecency.never",
};

/**
 * The staff-facing phrase for one diver's currency, or null when they were
 * never asked — a caller renders nothing at all in that case rather than a
 * "not said" line. Silence about currency is the state every booking taken
 * before 2026-08-21 is in, and a roster of "Last dived: not said" would be
 * noise on every row for weeks.
 */
export function diveRecencyText(
  t: StaffTranslator,
  band: DiveRecencyBand | null | undefined,
): string | null {
  if (band == null) return null;
  return t("shared.diveRecency.lastDived", { when: t(STAFF_DIVE_RECENCY_KEYS[band]) });
}

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
  return cachedListFormat(locale, { style: "long", type: "conjunction" }).format(parts);
}

/**
 * **The same gate, sized for a list row** — the parts of `tripRequirementList`
 * with the connective prose taken out, for the caller to set between separators.
 *
 * The public schedule shows fifteen departures at once, and until issue #695 it
 * showed none of their requirements: a diver had to open every card to learn
 * which they could book, and shops worked around it by typing the requirement
 * into the free-text description by hand — where it cannot be translated, and
 * where nothing reconciles it with the gate the booking form actually enforces.
 * The demo shop's own seed data did this on three cards.
 *
 * A sentence is the wrong shape there. *"This charter is for divers with
 * Advanced Open Water or higher, a Deep certification, and a nitrox
 * certification"* is right on the trip page, where a diver is deciding, and is
 * four lines of a card they are scanning. So the level keeps its "or higher"
 * — the one word here that changes the meaning rather than smoothing it — and
 * everything else is reduced to the name of the card being asked for.
 *
 * Empty when the trip demands nothing, and callers render nothing at all in
 * that case. There is no "no certification needed" marker, deliberately: it
 * would appear on almost every reef charter in the product and is the absence
 * of a rule dressed as a rule (the same deletion as "Payment: not required").
 */
export function tripRequirementMarkers(
  t: DiverTranslator,
  requirement: {
    minimumCertificationLevel: CertificationLevel | null;
    requiredSpecialties: readonly DiveSpecialty[];
    requiresNitrox: boolean;
  },
): string[] {
  return [
    requirement.minimumCertificationLevel
      ? t("trip.requirementLevel", {
          level: t(DIVER_CERTIFICATION_LEVEL_KEYS[requirement.minimumCertificationLevel]),
        })
      : null,
    ...requirement.requiredSpecialties.map((specialty) => t(DIVER_SPECIALTY_KEYS[specialty])),
    requirement.requiresNitrox ? t("trip.requirementMarkerNitrox") : null,
  ].filter((part): part is string => Boolean(part));
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
  certification_self_declared: "shared.readiness.blockers.certificationSelfDeclared",
  certification_insufficient: "shared.readiness.blockers.certificationInsufficient",
  specialty_missing: "shared.readiness.blockers.specialtyMissing",
  specialty_pending: "shared.readiness.blockers.specialtyPending",
  specialty_import_unconfirmed: "shared.readiness.blockers.specialtyImportUnconfirmed",
  nitrox_missing: "shared.readiness.blockers.nitroxMissing",
  nitrox_pending: "shared.readiness.blockers.nitroxPending",
  nitrox_self_declared: "shared.readiness.blockers.nitroxSelfDeclared",
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
        list: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(cards),
      }),
    );
  }
  // Nothing set is not a refusal `decideTripAdmission` can produce; the generic
  // sentence is the honest fallback rather than an empty banner.
  return sentences.length > 0 ? sentences.join(" ") : t("shared.tripAdmission.generic");
}

/**
 * Training agencies, diver-facing.
 *
 * Every entry but `other` is a brand name that reads the same in every
 * language, and they still go through the bundle rather than being spelled in
 * a component: `other` is real copy that has to translate, and a half-bundled
 * map is how the one translatable member gets forgotten. Same
 * key-set-per-audience split as the certification levels above — this one is
 * only ever looked up with a `DiverTranslator`.
 */
export const DIVER_CERTIFICATION_AGENCY_KEYS: Record<CertificationAgency, DiverMessageKey> = {
  padi: "common.certification.agencies.padi",
  ssi: "common.certification.agencies.ssi",
  naui: "common.certification.agencies.naui",
  sdi: "common.certification.agencies.sdi",
  tdi: "common.certification.agencies.tdi",
  cmas: "common.certification.agencies.cmas",
  raid: "common.certification.agencies.raid",
  gue: "common.certification.agencies.gue",
  bsac: "common.certification.agencies.bsac",
  other: "common.certification.agencies.other",
};
