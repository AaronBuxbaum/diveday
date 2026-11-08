import { ITEM_TITLE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ShopAnswersCard } from "./ShopAnswersCard";
import { type SignedWaiverRecord, signedWaiverView } from "./signed-waiver-view";

/**
 * **A signed release on the shop's paper** (issue #4142): whose it is, when
 * and how it was signed, the seal, the medical line and the prompts that
 * flagged, the answers to the shop's own questions, whether a medical alert is
 * on file, and the text the diver signed. The same facts the record's screen
 * reads (`signedWaiverView`), drawn as words, with no control and no link.
 */
export function SignedWaiverPaper({
  record,
  locale,
  timezone,
  t,
}: {
  record: SignedWaiverRecord;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const { waiver, shopAnswers } = record;
  const { when, facts, flagged, noAnswersText, medicalLine } = signedWaiverView({
    waiver,
    readsMedicalAnswers: record.can.readMedicalAnswers,
    locale,
    timezone,
    departure: (_tripId, text) => text,
    t,
  });
  const alertNote = waiver.identityHeld
    ? t("waiversStaff.record.medicalAlertHeld")
    : waiver.erasedAt
      ? t("waiversStaff.record.medicalAlertErased", { date: when(waiver.erasedAt) })
      : waiver.medicalAlertOnFile
        ? // The fact, not the screen's note on who may read it there.
          t("waiversStaff.record.medicalAlertOnFilePaper")
        : null;
  return (
    <div className="grid gap-6 text-sm">
      <header>
        <p className="font-semibold">{waiver.personName}</p>
        <h1 className={ITEM_TITLE_CLASS}>{t("waiversStaff.record.title")}</h1>
      </header>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-6 gap-y-2">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted">{fact.label}</dt>
            <dd className="font-medium [overflow-wrap:anywhere]">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <section className="break-inside-avoid">
        <h2 className={SECTION_TITLE_CLASS}>{t("waiversStaff.record.medicalHeading")}</h2>
        {medicalLine ? (
          <div className="mt-2 font-medium">
            <p>{medicalLine.text}</p>
            {waiver.medicalClearancePhysicianName ? (
              <p className="mt-1 font-normal">
                {t("waiversStaff.record.physician", {
                  name: waiver.medicalClearancePhysicianName,
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        {flagged.length > 0 ? (
          <ol className="mt-2 grid gap-1">
            {flagged.map((question) => (
              <li key={question.id} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 font-medium">{question.prompt}</span>
                <span className="shrink-0">{t("waiversStaff.record.answerYes")}</span>
              </li>
            ))}
          </ol>
        ) : noAnswersText ? (
          <p className="mt-2 text-muted">{noAnswersText}</p>
        ) : null}
        {alertNote ? <p className="mt-2 font-medium">{alertNote}</p> : null}
      </section>
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
          timezone={timezone}
          t={t}
        />
      ) : null}
      <section>
        <h2 className={SECTION_TITLE_CLASS}>{t("waiversStaff.record.releaseHeading")}</h2>
        <p className="mt-2 whitespace-pre-wrap">{waiver.templateBody}</p>
      </section>
    </div>
  );
}
