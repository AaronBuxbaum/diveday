import { SectionTabs } from "@/components/SectionTabs";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The four parts of Your data, in tab order. */
export type DataTabId = "export" | "backups" | "import" | "integrations";

/**
 * **Your data** (issue #2813): Export, Backups, Import and Integrations were
 * three rail rows for two pages and a fourth beside them. They are one place
 * now, in the section-tabs shape every sectioned page wears (ADR
 * 20261001-logbook): each page's `<h1>` is "Your data" and these tabs say which
 * part you are on. Plain links, each a page of its own, so a tab is a URL a
 * staffer can share. Every part is owner and manager work, the Settings gate's
 * own set, and each page re-checks its own permission.
 */
export function DataTabs({
  t,
  shopSlug,
  current,
}: {
  t: StaffTranslator;
  shopSlug: string;
  current: DataTabId;
}) {
  const base = `/shop/${shopSlug}/settings`;
  return (
    <SectionTabs
      label={t("settings.data.tabs.label")}
      current={current}
      tabs={[
        { id: "export", href: `${base}/export`, label: t("settings.data.tabs.export") },
        { id: "backups", href: `${base}/export/backups`, label: t("settings.data.tabs.backups") },
        { id: "import", href: `${base}/import`, label: t("settings.data.tabs.import") },
        {
          id: "integrations",
          href: `${base}/integrations`,
          label: t("settings.data.tabs.integrations"),
        },
      ]}
    />
  );
}
