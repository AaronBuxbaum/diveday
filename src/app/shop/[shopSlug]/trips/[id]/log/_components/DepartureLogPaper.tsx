import type { ReactNode } from "react";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The document owns its final gutter; the printed page margin already supplies it. */
export function DepartureLogFrame({ children }: { children: ReactNode }) {
  return (
    <div data-departure-log className="space-y-10 print:space-y-4">
      <style>{"@media print{main:has([data-departure-log]){padding-block-end:0}}"}</style>
      {children}
    </div>
  );
}

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
    <footer className="break-inside-avoid border-t border-border pt-4 text-sm print:break-before-avoid">
      <p className="font-semibold">
        {t("incidentExport.footerHashLabel")}
        {"\u00a0"}· {t("incidentExport.footerHashVersion", { version })}
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
    <div
      className={
        emptyReports
          ? "space-y-10 print:space-y-4 print:break-inside-avoid"
          : "space-y-10 print:space-y-4"
      }
    >
      {children}
    </div>
  );
}
