import { MoreMenu } from "@/components/MoreMenu";
import { buttonClass } from "@/components/ui/button";
import { menuRowClass } from "@/components/ui/menu";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/** The files for the report currently on screen. */
export function ReportExportMenu({
  t,
  shopSlug,
  range,
}: {
  t: StaffTranslator;
  shopSlug: string;
  range: { month: string } | { year: number };
}) {
  const query = "month" in range ? `month=${range.month}` : `year=${range.year}`;
  const files = [
    { href: shopPath(shopSlug, "reports", "download"), label: t("reports.downloadCsv") },
    ...("month" in range
      ? [
          {
            href: shopPath(shopSlug, "settings", "export", "crew-sheet"),
            label: t("reports.downloadCrewSheet"),
          },
          {
            href: shopPath(shopSlug, "reports", "download", "month-end"),
            label: t("reports.downloadMonthEnd"),
          },
        ]
      : []),
  ];
  return (
    <MoreMenu label={t("reports.export")}>
      {files.map((file) => (
        <a
          key={file.href}
          href={`${file.href}?${query}`}
          className={menuRowClass("quiet", { gutter: false })}
        >
          {file.label}
        </a>
      ))}
    </MoreMenu>
  );
}

export function MonthReportActions({
  t,
  shopSlug,
  month,
  hasActivity,
}: {
  t: StaffTranslator;
  shopSlug: string;
  month: string;
  hasActivity: boolean;
}) {
  return (
    <>
      {hasActivity ? (
        <a
          href={`${shopPath(shopSlug, "reports", "card")}?month=${month}`}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("reports.year.printCard")}
        </a>
      ) : null}
      <ReportExportMenu t={t} shopSlug={shopSlug} range={{ month }} />
    </>
  );
}
