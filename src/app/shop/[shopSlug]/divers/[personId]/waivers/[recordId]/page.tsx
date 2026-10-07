import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { canPersonReadMedicalAnswers, canPersonReadMedicalClearanceDocument } from "@/db/authz";
import { getSignedWaiverForDiver } from "@/db/waivers";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { formatDateTimeTz } from "@/lib/format";
import { applicableMedicalQuestions, findQuestionnaireVersion } from "@/lib/medical";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

export const instant = true;

/**
 * **The signed release itself** — what "View signed record" opens (Aaron,
 * 2026-10-06: "you actually can't even view the signed record!"). The trip
 * roster's link used to land on the shop-wide signature log, a row of which
 * says a release exists and links back to the diver; nowhere in the product
 * could a staffer read what the diver had actually signed and answered.
 *
 * A child of the diver's record, because a release is a fact about the
 * person. The release, its signature and its seal are open to every staff
 * member who reads that record. The questionnaire is not: an owner or manager
 * reads every answer and the physician's name (`canReadMedicalAnswers`, the
 * same wall as the bulk export), and everyone else sees what the trip roster
 * already shows them, the prompts that flagged, which is what whoever records
 * a clearance needs to read. The physician's evaluation itself stays behind
 * its own door (`canReadMedicalClearanceDocument`), which this page only links
 * to. A seat still held over who is in it (H-13) shows no answers at all.
 */
export default async function SignedWaiverPage({
  params,
}: {
  params: Promise<{ shopSlug: string; personId: string; recordId: string }>;
}) {
  const { shopSlug, personId, recordId } = await params;
  if (!uuidParam(personId) || !uuidParam(recordId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const [readsMedicalAnswers, canOpenEvaluation] = await Promise.all([
    canPersonReadMedicalAnswers(db, shop.id, session.user.personId),
    canPersonReadMedicalClearanceDocument(db, shop.id, session.user.personId),
  ]);
  const waiver = await getSignedWaiverForDiver(db, {
    shopId: shop.id,
    personId,
    recordId,
    readsMedicalAnswers,
  });
  if (!waiver) notFound();

  const when = (date: Date) => formatDateTimeTz(date, locale, shop.timezone);
  const evaluatedOn =
    waiver.medicalClearanceEvaluatedOn && isValidCalendarDate(waiver.medicalClearanceEvaluatedOn)
      ? formatCalendarDate(waiver.medicalClearanceEvaluatedOn, locale)
      : "";
  const seal =
    waiver.integrity === "valid"
      ? waiver.guardianEmailErasedAt
        ? t("waiversStaff.record.sealValidGuardianRedacted", {
            date: when(waiver.guardianEmailErasedAt),
          })
        : t("waiversStaff.record.sealValid")
      : waiver.integrity === "unsealed"
        ? t("waiversStaff.signatures.integrityUnsealed")
        : t("waiversStaff.signatures.integrityInvalid");
  const facts: { label: string; value: React.ReactNode }[] = [
    ...(waiver.signedAt
      ? [{ label: t("waiversStaff.record.signedLabel"), value: when(waiver.signedAt) }]
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
            : t("waiversStaff.record.howOnline"),
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
            value: (
              <Link
                href={shopPath(shopSlug, "trips", waiver.trip.id)}
                className="text-primary hover:underline"
              >
                {waiver.trip.startsAt
                  ? `${waiver.trip.title} · ${when(waiver.trip.startsAt)}`
                  : waiver.trip.title}
              </Link>
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

  // The questions this diver was actually asked: a Box opens only on a yes to
  // its parent, so an unopened Box is blank on the paper form, not "no".
  const questionnaire = waiver.medicalAnswers
    ? findQuestionnaireVersion(
        waiver.medicalAnswers.questionnaireId,
        waiver.medicalAnswers.questionnaireVersion,
      )
    : null;
  const answered =
    questionnaire && waiver.medicalAnswers
      ? applicableMedicalQuestions(questionnaire, waiver.medicalAnswers.responses)
          .filter((question) => typeof waiver.medicalAnswers?.responses[question.id] === "boolean")
          .map((question) => ({
            id: question.id,
            prompt: question.prompt,
            yes: waiver.medicalAnswers?.responses[question.id] === true,
          }))
      : waiver.flaggedPrompts.map((prompt) => ({ id: prompt, prompt, yes: true }));
  const noAnswersText = waiver.identityHeld
    ? t("waiversStaff.record.identityHeld")
    : !readsMedicalAnswers
      ? t("waiversStaff.record.answersRestricted")
      : waiver.signatureMethod === "in_person_attested"
        ? t("waiversStaff.record.noQuestionnairePaper")
        : t("waiversStaff.record.noQuestionnaire");
  // A refusal retired off its seat (`retireMedicalRefusal`) is not replaced by
  // anything yet: it still blocks the diver, and saying "replaced" would read
  // as void.
  const retiredRefusal =
    waiver.supersededAt && waiver.medicalClearanceDeclinedAt && !waiver.medicalClearedAt;
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={waiver.personName}
        eyebrowHref={`${shopPath(shopSlug, "divers", waiver.personId)}#waiver`}
        title={t("waiversStaff.record.title")}
      />
      {waiver.supersededAt ? (
        <p className="mt-4 text-sm text-muted">
          {retiredRefusal
            ? t("waiversStaff.record.newWaiverSent", { date: when(waiver.supersededAt) })
            : t("waiversStaff.record.replaced", { date: when(waiver.supersededAt) })}
        </p>
      ) : null}
      <div className="mt-8 space-y-10">
        <SectionCard>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-muted">{fact.label}</dt>
                <dd className="-mt-2 font-medium [overflow-wrap:anywhere] sm:mt-0">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>

        <SectionCard title={t("waiversStaff.record.medicalHeading")}>
          {medicalLine ? (
            <div className={`mb-4 text-sm font-medium ${medicalLine.tone}`}>
              <p>{medicalLine.text}</p>
              {waiver.medicalClearancePhysicianName ? (
                <p className="mt-1 font-normal text-muted">
                  {t("waiversStaff.record.physician", {
                    name: waiver.medicalClearancePhysicianName,
                  })}
                </p>
              ) : null}
              {canOpenEvaluation && waiver.medicalClearanceDocumentOnFile ? (
                <a
                  href={`/api/medical-clearances/${waiver.id}`}
                  // An attachment: a new tab keeps this page where it is.
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass({ variant: "link", size: "sm", flush: true })}
                >
                  {t("divers.waiver.openClearanceDocument")}
                </a>
              ) : null}
            </div>
          ) : null}
          {answered.length > 0 ? (
            <ol className="grid gap-2 text-sm">
              {answered.map((question) => (
                <li
                  key={question.id}
                  className={`flex items-baseline justify-between gap-4 ${
                    question.yes ? "font-medium text-warning-strong" : ""
                  }`}
                >
                  <span className="min-w-0">{question.prompt}</span>
                  <span className="shrink-0 tabular-nums">
                    {question.yes
                      ? t("waiversStaff.record.answerYes")
                      : t("waiversStaff.record.answerNo")}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">{noAnswersText}</p>
          )}
        </SectionCard>

        <SectionCard title={t("waiversStaff.record.releaseHeading")}>
          <p className="text-sm whitespace-pre-wrap text-muted">{waiver.templateBody}</p>
        </SectionCard>
      </div>
    </main>
  );
}
