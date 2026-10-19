import { SectionTabs } from "@/components/SectionTabs";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The kind of file an import takes, as tabs under "Your data"'s own: Divers,
 * Gear, Dive sites. `?what=` picks one (`importTab` in `page.tsx`); the Divers
 * tab is the bare URL, the one a switching shop arrives for.
 */
export function ImportKindTabs({
  t,
  base,
  current,
}: {
  t: StaffTranslator;
  base: string;
  current: "divers" | "gear" | "dive-sites";
}) {
  return (
    <SectionTabs
      label={t("settings.import.tabs.label")}
      current={current}
      tabs={[
        { id: "divers", href: base, label: t("settings.import.tabs.divers") },
        { id: "gear", href: `${base}?what=gear`, label: t("settings.import.tabs.gear") },
        {
          id: "dive-sites",
          href: `${base}?what=dive-sites`,
          label: t("settings.import.tabs.diveSites"),
        },
      ]}
    />
  );
}
