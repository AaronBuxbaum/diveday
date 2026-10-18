import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { IncidentReportView } from "@/db/incident-reports";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";

/**
 * **Who was told, and "Found"** on a missing-diver report whose owners were
 * alerted (issue #2694): when the alert went, and, once the diver is found,
 * when and by whom. "Found" sends the same owners one quiet all-clear; it
 * stands on a draft too, since the alert can go before the report is written.
 */
export function MissingDiverAlert({
  alert,
  mayWrite,
  action,
  locale,
  timeZone,
  t,
}: {
  alert: NonNullable<IncidentReportView["ownersAlert"]>;
  mayWrite: boolean;
  action: () => Promise<void>;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const at = (date: Date) => formatDateTimeTz(date, locale, timeZone);
  return (
    <SectionCard>
      <dl className="space-y-3">
        <div>
          <dt className="text-sm font-medium text-muted">{t("incidents.read.ownersAlerted")}</dt>
          <dd className="mt-1">
            {alert.sentAt ? (
              at(alert.sentAt)
            ) : (
              <span className="font-semibold text-warning-strong">
                {t("incidents.read.ownersNotReached")}
              </span>
            )}
          </dd>
        </div>
        {alert.foundAt ? (
          <div>
            <dt className="text-sm font-medium text-muted">{t("incidents.found.label")}</dt>
            <dd className="mt-1">
              {t("incidents.found.byAt", {
                name: alert.foundByName ?? "",
                when: at(alert.foundAt),
              })}
            </dd>
            {alert.allClear?.state === "sent" ? (
              <dd className="mt-1 text-sm text-muted">
                {t("incidents.found.allClearSent", { when: at(alert.allClear.sentAt) })}
              </dd>
            ) : alert.allClear ? (
              <dd className="mt-1 text-sm font-semibold text-warning-strong">
                {t(
                  alert.allClear.state === "partial"
                    ? "incidents.found.allClearPartial"
                    : "incidents.found.allClearNone",
                )}
              </dd>
            ) : null}
          </div>
        ) : null}
      </dl>
      {!alert.foundAt && mayWrite ? (
        <form action={action} className="mt-4 print:hidden">
          <p className="text-sm text-muted">{t("incidents.found.help")}</p>
          <SubmitButton
            pendingLabel={t("incidents.found.pending")}
            className={buttonClass({ variant: "secondary", className: "mt-3" })}
          >
            {t("incidents.found.submit")}
          </SubmitButton>
        </form>
      ) : null}
    </SectionCard>
  );
}
