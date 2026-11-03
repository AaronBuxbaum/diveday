import type { ReactNode } from "react";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** Keep the full verification code intact and attached to the preceding record. */
export function DepartureLogFooter({
  hash,
  version,
  t,
}: {
  hash: string;
  version: number;
  t: StaffTranslator;
}) {
  return (
    <footer className="break-inside-avoid break-before-avoid border-t border-border pt-4 text-sm">
      <p className="font-semibold">
        {t("incidentExport.footerHashLabel")}
        {" "}· {t("incidentExport.footerHashVersion", { version })}
      </p>
      <p className="mt-1 font-mono text-xs break-all">{hash}</p>
      <p className="mt-2 max-w-prose text-muted">{t("incidentExport.footerHashExplainer")}</p>
    </footer>
  );
}

/** Only an empty report summary has a bounded length that can travel with the code. */
export function DepartureLogClosing({
  children,
  emptyReports,
}: {
  children: ReactNode;
  emptyReports: boolean;
}) {
  return (
    <div className={emptyReports ? "space-y-6 break-inside-avoid" : "space-y-6"}>{children}</div>
  );
}
