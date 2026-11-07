import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ScreenNotPrinted } from "@/components/paper/ScreenNotPrinted";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { WaiverSignedVia } from "@/db/schema";
import { getSignedWaiverPage } from "@/db/signed-waiver-page";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { requestLocale } from "@/i18n/request";
import { ownerOrManagerWords, sayWords } from "@/i18n/shared-sentences";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { formatDateTimeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED } from "@/lib/waiver-integrity";
import { MedicalAlertCard } from "./_components/MedicalAlertCard";
import { MedicalAnswers } from "./_components/MedicalAnswers";
import { ShopAnswersCard } from "./_components/ShopAnswersCard";
import { showMedicalAlertOnRecordAction, showMedicalAnswersAction } from "./actions";

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
 * member who reads that record. The questionnaire is not: an owner or
 * manager reads the physician's name and, by tapping "Show answers", every
 * answer (`canReadMedicalAnswers`, the same wall as the bulk export). The
 * tap's action puts who read them on the diver's trail (issue #2157), never
 * the render, which a prefetch or a reload would log for nobody. Everyone
 * else, and a manager before the tap, sees what the trip roster already
 * shows them, the prompts that flagged, which is what whoever records a
 * clearance needs to read. The physician's evaluation itself stays behind
 * its own door (`canReadMedicalClearanceDocument`), which this page only links
 * to. A seat still held over who is in it (H-20260724-one-person-per-email) shows no answers at all.
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
  // What this reader may read comes from live roles; never the full
  // questionnaire on render — an owner or manager reads it by tapping "Show
  // answers", whose action records the read (issue #2157). The medical alert
  // is owner and manager only here: this page has no departure whose crew the
  // reader could be on (issue #2960).
  const record = await getSignedWaiverPage(db, shop.id, personId, recordId, session.user.personId);
  if (!record) notFound();
  const {
    waiver,
    // The answers to the shop's own questions: every staff role reads them, as
    // they read the release (glossary *Shop question*).
    shopAnswers,
    can: {
      readMedicalAnswers: readsMedicalAnswers,
      openEvaluation: canOpenEvaluation,
      readMedicalAlert: readsMedicalAlert,
    },
  } = record;

  const when = (date: Date) => formatDateTimeTz(date, locale, shop.timezone);
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
  const facts: { label: string; value: React.ReactNode }[] = [
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

  // What every staff role reads without a tap: the prompts that flagged.
  const flagged = waiver.flaggedPrompts.map((prompt) => ({ id: prompt, prompt, yes: true }));
  const showsAnswers = readsMedicalAnswers && waiver.medicalAnswersOnFile;
  const noAnswersText = waiver.identityHeld
    ? t("waiversStaff.record.identityHeld")
    : !readsMedicalAnswers
      ? sayWords(t, ownerOrManagerWords("questionnaire"))
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
    <StaffPage width="reading">
      {/* Revealed medical answers never reach paper (`ScreenNotPrinted`). */}
      <ScreenNotPrinted>{t("waiversStaff.record.screenOnPaper")}</ScreenNotPrinted>
      <ShopPageHeader eyebrow={waiver.personName} title={t("waiversStaff.record.title")} />
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
                  // A door, never a fact: the document behind it is not on
                  // this paper, and its words would read as one.
                  className={buttonClass({
                    variant: "link",
                    size: "sm",
                    flush: true,
                  })}
                >
                  {t("divers.waiver.openClearanceDocument")}
                </a>
              ) : null}
              {/* Never read as staff-sourced evidence (issue #2797). */}
              {waiver.medicalClearanceDocumentOnFile && waiver.medicalClearanceDocumentFromDiver ? (
                <p className="mt-1 font-normal text-muted">
                  {t("divers.waiver.evaluationFromDiver")}
                </p>
              ) : null}
            </div>
          ) : null}
          <MedicalAnswers
            flagged={flagged}
            show={
              showsAnswers
                ? showMedicalAnswersAction.bind(null, shopSlug, waiver.personId, waiver.id)
                : undefined
            }
            emptyText={noAnswersText}
            copy={{
              yes: t("waiversStaff.record.answerYes"),
              no: t("waiversStaff.record.answerNo"),
              show: t("waiversStaff.record.showAnswers"),
              showing: t("waiversStaff.record.showingAnswers"),
              showHint: t("waiversStaff.record.showAnswersHint"),
              failed: t("waiversStaff.record.showAnswersFailed"),
            }}
          />
        </SectionCard>

        {shopAnswers ? (
          <ShopAnswersCard
            shopAnswers={shopAnswers.shopAnswers}
            versionAsked={shopAnswers.versionAsked}
            notOnThisRelease={shopAnswers.notOnThisRelease}
            erasedAt={shopAnswers.erasedAt}
            signatureMethod={waiver.signatureMethod}
            templateVersion={waiver.templateVersion}
            signedAt={waiver.signedAt}
            identityHeld={shopAnswers.identityHeld}
            locale={locale}
            timezone={shop.timezone}
            t={t}
          />
        ) : null}

        <MedicalAlertCard
          onFile={waiver.medicalAlertOnFile}
          show={
            readsMedicalAlert && waiver.medicalAlertOnFile
              ? showMedicalAlertOnRecordAction.bind(null, shopSlug, waiver.personId, waiver.id)
              : undefined
          }
          identityHeld={waiver.identityHeld}
          erasedAt={waiver.erasedAt}
          signatureMethod={waiver.signatureMethod}
          locale={locale}
          timezone={shop.timezone}
          t={t}
        />

        <SectionCard title={t("waiversStaff.record.releaseHeading")}>
          <p className="text-sm whitespace-pre-wrap text-muted">{waiver.templateBody}</p>
        </SectionCard>
      </div>
    </StaffPage>
  );
}

/**
 * Which kind of door an online signature came through (issue #4045): the
 * question a counter code and a mailed link to one release leave open. A
 * release signed before it was recorded says only "Online".
 */
function onlineDoorText(
  t: ReturnType<typeof staffTranslator>,
  signedVia: WaiverSignedVia | null,
): string {
  if (signedVia === "thread") return t("waiversStaff.record.howThread");
  if (signedVia === "counter") return t("waiversStaff.record.howCounter");
  if (signedVia === "party_door") return t("waiversStaff.record.howPartyDoor");
  if (signedVia === "release_link") return t("waiversStaff.record.howReleaseLink");
  return t("waiversStaff.record.howOnline");
}
