import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field, FormStatus, textareaClassFor } from "@/components/ui/form";
import type { IncidentReportView } from "@/db/incident-reports";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { INCIDENT_TEXT_MAX, type IncidentFilingGap } from "@/lib/incident-reports";
import type { FormNotice } from "@/lib/staff-notices";
import { FILING_GAP_KEYS, HANDOVER_KIND_KEYS } from "./incident-words";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3 sm:grid sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-line sm:mt-0">{children}</dd>
    </div>
  );
}

/**
 * The report as it reads once filed, or to an owner or manager reading
 * somebody else's draft: every answer, and an unanswered one said in words
 * rather than left blank.
 */
export function IncidentRecord({
  report,
  locale,
  timeZone,
  t,
}: {
  report: IncidentReportView;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const { fields } = report;
  const at = (date: Date) => formatDateTimeTz(date, locale, timeZone);
  const notWritten = <span className="text-muted">{t("incidents.read.notWritten")}</span>;
  const yesNo = (value: boolean | null) =>
    value === null ? (
      <span className="text-muted">{t("incidents.read.notAnswered")}</span>
    ) : (
      t(value ? "incidents.form.yes" : "incidents.form.no")
    );
  const where = [report.diveSiteName, fields.locationText].filter(Boolean).join(" · ");
  const handoverWho = fields.handoverKind
    ? [t(HANDOVER_KIND_KEYS[fields.handoverKind]), fields.handoverDetail].filter(Boolean).join(": ")
    : null;
  return (
    <SectionCard>
      <dl className="-my-3 divide-y divide-border">
        <Row label={t("incidents.read.when")}>
          {fields.occurredAt ? at(fields.occurredAt) : notWritten}
        </Row>
        <Row label={t("incidents.read.where")}>{where || notWritten}</Row>
        <Row label={t("incidents.form.whatHappened")}>{fields.whatHappened ?? notWritten}</Row>
        <Row label={t("incidents.form.firstAid")}>{yesNo(fields.firstAidGiven)}</Row>
        <Row label={t("incidents.form.oxygen")}>
          {fields.oxygenGiven && fields.oxygenMinutes !== null
            ? t("incidents.read.oxygenFor", { minutes: fields.oxygenMinutes })
            : yesNo(fields.oxygenGiven)}
        </Row>
        <Row label={t("incidents.form.emergencyServices")}>
          {yesNo(fields.emergencyServicesCalled)}
        </Row>
        <Row label={t("incidents.form.handoverKind")}>
          {/* Unanswered is said as such: a blank never reads as "nobody took over". */}
          {handoverWho ? (
            fields.handedOverAt ? (
              t("incidents.read.handoverAt", { who: handoverWho, when: at(fields.handedOverAt) })
            ) : (
              handoverWho
            )
          ) : (
            <span className="text-muted">{t("incidents.read.notAnswered")}</span>
          )}
        </Row>
        <Row label={t("incidents.form.followUp")}>{fields.followUp ?? notWritten}</Row>
      </dl>
    </SectionCard>
  );
}

/** Filing: what is still missing, and the one button. */
export function IncidentFiling({
  gaps,
  action,
  notice,
  t,
}: {
  gaps: readonly IncidentFilingGap[];
  action: () => Promise<void>;
  notice: FormNotice | undefined;
  t: StaffTranslator;
}) {
  return (
    <SectionCard title={t("incidents.file.title")} description={t("incidents.file.description")}>
      {gaps.length > 0 ? (
        <div className="mb-4">
          <p className="text-sm font-medium">{t("incidents.file.needs")}</p>
          <ul className="mt-1 list-disc ps-5 text-sm">
            {gaps.map((gap) => (
              <li key={gap}>{t(FILING_GAP_KEYS[gap])}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form action={action} className="flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={t("incidents.file.pending")}
          disabled={gaps.length > 0}
          className={buttonClass()}
        >
          {t("incidents.file.submit")}
        </SubmitButton>
        <FormStatus tone={notice?.tone}>{notice?.text}</FormStatus>
      </form>
    </SectionCard>
  );
}

/** The dated notes under a filed report, and the box to add one. */
export function IncidentAddenda({
  addenda,
  locale,
  timeZone,
  action,
  notice,
  t,
}: {
  addenda: IncidentReportView["addenda"];
  locale: string;
  timeZone: string;
  action: ((formData: FormData) => Promise<void>) | null;
  notice: FormNotice | undefined;
  t: StaffTranslator;
}) {
  return (
    <SectionCard
      id="addenda"
      className="scroll-mt-24"
      title={t("incidents.addenda.title")}
      description={t("incidents.addenda.description")}
    >
      {addenda.length === 0 ? (
        <p className="text-muted">{t("incidents.addenda.empty")}</p>
      ) : (
        <ol className="divide-y divide-border">
          {addenda.map((addendum) => (
            <li key={addendum.id} className="py-3 first:pt-0">
              <p className="text-sm text-muted">
                {t("incidents.addenda.by", {
                  name: addendum.authorName,
                  date: formatDateTimeTz(addendum.createdAt, locale, timeZone),
                })}
              </p>
              <p className="mt-1 whitespace-pre-line">{addendum.body}</p>
            </li>
          ))}
        </ol>
      )}
      {action ? (
        <form action={action} className="mt-6 space-y-4 border-t border-border pt-6">
          <Field label={t("incidents.addenda.label")}>
            <textarea
              rows={3}
              name="body"
              required
              maxLength={INCIDENT_TEXT_MAX}
              className={textareaClassFor(3)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton
              pendingLabel={t("incidents.addenda.pending")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("incidents.addenda.submit")}
            </SubmitButton>
            <FormStatus tone={notice?.tone}>{notice?.text}</FormStatus>
          </div>
        </form>
      ) : null}
    </SectionCard>
  );
}
