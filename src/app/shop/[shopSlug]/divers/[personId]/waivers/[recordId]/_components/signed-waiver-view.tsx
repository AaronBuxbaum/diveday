import type { ReactNode } from "react";
import type { WaiverSignedVia } from "@/db/schema";
import type { getSignedWaiverPage } from "@/features/signed-waiver-page";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { ownerOrManagerWords, sayWords } from "@/i18n/shared-sentences";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { formatDateTimeTz } from "@/lib/format";
import { WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED } from "@/lib/waiver-integrity";

export type SignedWaiverRecord = NonNullable<Awaited<ReturnType<typeof getSignedWaiverPage>>>;
type Waiver = SignedWaiverRecord["waiver"];

/**
 * **What a signed release says, once, for its screen and its sheet** (issue
 * #4142). The record page and its printed sheet read the same facts, seal,
 * medical line and empty-questionnaire sentence from here, so the paper never
 * says something the screen does not.
 */
export function signedWaiverView({
  waiver,
  readsMedicalAnswers,
  locale,
  timezone,
  departure,
  t,
}: {
  waiver: Waiver;
  readsMedicalAnswers: boolean;
  locale: string;
  timezone: string;
  /** The departure's words as the medium draws them: a link on screen, words on paper. */
  departure: (tripId: string, text: string) => ReactNode;
  t: StaffTranslator;
}) {
  const when = (date: Date) => formatDateTimeTz(date, locale, timezone);
  const evaluatedOn =
    waiver.medicalClearanceEvaluatedOn && isValidCalendarDate(waiver.medicalClearanceEvaluatedOn)
      ? formatCalendarDate(waiver.medicalClearanceEvaluatedOn, locale)
      : "";
  const seal =
    waiver.integrity === "invalid"
      ? t("waiversStaff.signatures.integrityInvalid")
      : waiver.signatureMethod === "in_person_attested"
        ? t("waiversStaff.record.paperEvidence")
        : waiver.integrity === "valid"
          ? // Only the version 4 seal covers the redaction; on any other the
            // stamp is a column beside the seal, not a fact the seal vouches for.
            waiver.integrityVersion === WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED &&
            waiver.guardianEmailErasedAt
            ? t("waiversStaff.record.sealValidGuardianRedacted", {
                date: when(waiver.guardianEmailErasedAt),
              })
            : t("waiversStaff.record.sealValid")
          : t("waiversStaff.signatures.integrityUnsealed");
  const facts: { label: string; value: ReactNode }[] = [
    ...(waiver.signedAt
      ? [{ label: t("waiversStaff.record.signedLabel"), value: when(waiver.signedAt) }]
      : []),
    ...(waiver.signatureMethod === "in_person_attested"
      ? [
          {
            label: t("waiversStaff.record.recordedByLabel"),
            value: waiver.recorderName ?? t("waiversStaff.record.recorderUnknown"),
          },
          ...(waiver.recordedAt
            ? [{ label: t("waiversStaff.record.recordedAtLabel"), value: when(waiver.recordedAt) }]
            : []),
        ]
      : []),
    ...(waiver.signedName
      ? [{ label: t("waiversStaff.record.signedAsLabel"), value: waiver.signedName }]
      : []),
    {
      label: t("waiversStaff.record.howLabel"),
      value:
        waiver.signatureMethod === "in_person_attested"
          ? t("waiversStaff.record.howPaper")
          : waiver.signatureMethod === "imported"
            ? t("waiversStaff.record.howImported")
            : onlineDoorText(t, waiver.signedVia),
    },
    {
      label: t("waiversStaff.record.releaseLabel"),
      value: t("waiversStaff.record.releaseValue", {
        title: waiver.templateTitle,
        version: waiver.templateVersion,
      }),
    },
    ...(waiver.trip
      ? [
          {
            label: t("waiversStaff.record.departureLabel"),
            value: departure(
              waiver.trip.id,
              waiver.trip.startsAt
                ? `${waiver.trip.title} · ${when(waiver.trip.startsAt)}`
                : waiver.trip.title,
            ),
          },
        ]
      : []),
    ...(waiver.guardian
      ? [
          {
            label: t("waiversStaff.record.coSignedLabel"),
            value: guardianCoSignedText(t, waiver.guardian),
          },
        ]
      : []),
    { label: t("waiversStaff.record.sealLabel"), value: seal },
  ];

  // What every staff role reads without a tap: the prompts that flagged.
  const flagged = waiver.flaggedPrompts.map((prompt) => ({ id: prompt, prompt, yes: true }));
  const noAnswersText = waiver.identityHeld
    ? t("waiversStaff.record.identityHeld")
    : !readsMedicalAnswers
      ? sayWords(t, ownerOrManagerWords("questionnaire"))
      : waiver.signatureMethod === "in_person_attested"
        ? t("waiversStaff.record.noQuestionnairePaper")
        : t("waiversStaff.record.noQuestionnaire");
  const medicalLine =
    waiver.status !== "medical_review"
      ? null
      : waiver.medicalClearedAt
        ? {
            tone: "text-success",
            text: t("waiversStaff.record.medicalCleared", { date: evaluatedOn }),
          }
        : waiver.medicalClearanceDeclinedAt
          ? {
              tone: "text-danger",
              text: t("waiversStaff.record.medicalNotCleared", { date: evaluatedOn }),
            }
          : { tone: "text-danger", text: t("waiversStaff.record.medicalReview") };
  return { when, facts, flagged, noAnswersText, medicalLine };
}

/**
 * Which kind of door an online signature came through (issue #4045): the
 * question a counter code and a mailed link to one release leave open. A
 * release signed before it was recorded says only "Online".
 */
function onlineDoorText(t: StaffTranslator, signedVia: WaiverSignedVia | null): string {
  if (signedVia === "thread") return t("waiversStaff.record.howThread");
  if (signedVia === "counter") return t("waiversStaff.record.howCounter");
  if (signedVia === "party_door") return t("waiversStaff.record.howPartyDoor");
  if (signedVia === "release_link") return t("waiversStaff.record.howReleaseLink");
  return t("waiversStaff.record.howOnline");
}
