import { MoreMenu } from "@/components/MoreMenu";
import { menuRowClass } from "@/components/ui/menu";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/** The month's three files behind one Export menu (visual review A06). */
export function ReportExportMenu({
  t,
  shopSlug,
  month,
}: {
  t: StaffTranslator;
  shopSlug: string;
  /** `YYYY-MM`, the month on screen. */
  month: string;
}) {
  const files = [
    { href: shopPath(shopSlug, "reports", "download"), label: t("reports.downloadCsv") },
    {
      href: shopPath(shopSlug, "settings", "export", "crew-sheet"),
      label: t("reports.downloadCrewSheet"),
    },
    {
      href: shopPath(shopSlug, "reports", "download", "month-end"),
      label: t("reports.downloadMonthEnd"),
    },
  ];
  return (
    <MoreMenu label={t("reports.export")}>
      {files.map((file) => (
        <a
          key={file.href}
          href={`${file.href}?month=${month}`}
          className={menuRowClass("quiet", { gutter: false })}
        >
          {file.label}
        </a>
      ))}
    </MoreMenu>
  );
}
