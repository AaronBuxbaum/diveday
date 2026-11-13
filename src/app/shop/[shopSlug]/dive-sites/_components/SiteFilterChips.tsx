import { FilterChips } from "@/components/ui/FilterChips";
import {
  SITE_DIFFICULTY_FILTERS,
  SITE_NEED_FILTERS,
  type SiteListFilters,
  siteListHref,
} from "@/features/dive-sites";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The two rows of chips that narrow the library: how demanding a site is, and
 * what kind of dive it asks for. Each chip is a link whose URL keeps the search
 * and the other choices, so a filtered list reloads, shares and goes back.
 */
export function SiteFilterChips({
  libraryPath,
  query,
  filters,
  t,
  diverT,
}: {
  libraryPath: string;
  query: string;
  filters: SiteListFilters;
  t: StaffTranslator;
  diverT: DiverTranslator;
}) {
  const href = (change: SiteListFilters) =>
    siteListHref(libraryPath, { q: query, ...filters, ...change });
  const all = t("diveSites.list.filterAll");
  const difficultyChips = [
    { key: "all", label: all, active: !filters.difficulty, href: href({ difficulty: undefined }) },
    ...SITE_DIFFICULTY_FILTERS.map((difficulty) => ({
      key: difficulty,
      label:
        difficulty === "unrated"
          ? t("diveSites.list.groups.unrated")
          : diveSiteDifficultyLabel(difficulty, diverT),
      active: filters.difficulty === difficulty,
      href: href({ difficulty }),
    })),
  ];
  const needChips = [
    { key: "all", label: all, active: !filters.need, href: href({ need: undefined }) },
    ...SITE_NEED_FILTERS.map((need) => ({
      key: need,
      label: need === "nitrox" ? t("diveSites.list.nitroxBadge") : t(SPECIALTY_KEYS[need]),
      active: filters.need === need,
      href: href({ need }),
    })),
  ];
  return (
    <div className="mb-6 space-y-2">
      <FilterChips label={t("diveSites.list.filterDifficultyLabel")} chips={difficultyChips} />
      <FilterChips label={t("diveSites.list.filterNeedLabel")} chips={needChips} />
    </div>
  );
}
