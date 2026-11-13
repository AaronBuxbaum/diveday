import Link from "next/link";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";
import { filterChipClass } from "@/components/ui/FilterChips";
import { SearchField } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import { QueryForm } from "@/components/ui/QueryForm";
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
import { FiltersPopover } from "./FiltersPopover";

/**
 * **One toolbar for both views of the dive sites**, the shop's own and DiveDay's
 * catalog: a search box and one Filters button, with what is on shown as small
 * pills you can drop. Everything is in the URL, so a filtered view reloads,
 * shares and goes back, and the map and the list both read it.
 */
export function SiteToolbar({
  base,
  view,
  query,
  filters,
  t,
  diverT,
}: {
  /** The page's path, without a query. */
  base: string;
  view?: "catalog";
  query: string;
  filters: SiteListFilters;
  t: StaffTranslator;
  diverT: DiverTranslator;
}) {
  const href = (change: { q?: string } & SiteListFilters) =>
    siteListHref(base, { view, q: query, ...filters, ...change });
  const difficultyLabel = (difficulty: (typeof SITE_DIFFICULTY_FILTERS)[number]) =>
    difficulty === "unrated"
      ? t("diveSites.list.groups.unrated")
      : diveSiteDifficultyLabel(difficulty, diverT);
  const needLabel = (need: (typeof SITE_NEED_FILTERS)[number]) =>
    need === "nitrox" ? t("diveSites.list.nitroxBadge") : t(SPECIALTY_KEYS[need]);
  const activeCount = (filters.difficulty ? 1 : 0) + (filters.need ? 1 : 0);
  const pills = [
    filters.difficulty
      ? {
          key: "difficulty",
          label: difficultyLabel(filters.difficulty),
          off: href({ difficulty: undefined }),
        }
      : null,
    filters.need
      ? { key: "need", label: needLabel(filters.need), off: href({ need: undefined }) }
      : null,
  ].filter((pill): pill is NonNullable<typeof pill> => pill !== null);

  return (
    <div className="mb-4 space-y-3">
      <QueryForm
        aria-label={t("diveSites.list.searchAriaLabel")}
        className="flex items-center gap-2"
      >
        <SearchField
          key={query}
          id="site-search"
          name="q"
          label={t("diveSites.list.searchLabel")}
          defaultValue={query}
          placeholder={t("diveSites.list.searchPlaceholder")}
          className="min-w-0 flex-1 sm:max-w-md"
        />
        {query ? (
          <Link
            href={href({ q: undefined })}
            scroll={false}
            aria-label={t("diveSites.list.searchClear")}
            title={t("diveSites.list.searchClear")}
            className={buttonClass({ variant: "ghost", size: "icon" })}
          >
            <DiveDayIcon name="close" className="size-4" />
          </Link>
        ) : null}
        {/* The choices the box does not own ride along when it submits. */}
        {view ? <input type="hidden" name="view" value={view} /> : null}
        {filters.difficulty ? (
          <input type="hidden" name="difficulty" value={filters.difficulty} />
        ) : null}
        {filters.need ? <input type="hidden" name="need" value={filters.need} /> : null}
        <FiltersPopover label={t("diveSites.list.filters")} activeCount={activeCount}>
          <section>
            <GroupLabel as="h2">{t("diveSites.list.filterDifficultyLabel")}</GroupLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {SITE_DIFFICULTY_FILTERS.map((difficulty) => (
                <Link
                  key={difficulty}
                  href={href({
                    difficulty: filters.difficulty === difficulty ? undefined : difficulty,
                  })}
                  scroll={false}
                  aria-current={filters.difficulty === difficulty ? "true" : undefined}
                  className={filterChipClass(filters.difficulty === difficulty)}
                >
                  {difficultyLabel(difficulty)}
                </Link>
              ))}
            </div>
          </section>
          <section>
            <GroupLabel as="h2">{t("diveSites.list.filterNeedLabel")}</GroupLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {SITE_NEED_FILTERS.map((need) => (
                <Link
                  key={need}
                  href={href({ need: filters.need === need ? undefined : need })}
                  scroll={false}
                  aria-current={filters.need === need ? "true" : undefined}
                  className={filterChipClass(filters.need === need)}
                >
                  {needLabel(need)}
                </Link>
              ))}
            </div>
          </section>
          {activeCount > 0 ? (
            <Link
              href={href({ difficulty: undefined, need: undefined })}
              scroll={false}
              className="inline-block text-sm font-medium text-primary underline"
            >
              {t("diveSites.list.clearFilters")}
            </Link>
          ) : null}
        </FiltersPopover>
      </QueryForm>
      {pills.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {pills.map((pill) => (
            <li key={pill.key}>
              <Link
                href={pill.off}
                scroll={false}
                aria-label={`${pill.label}: ${t("diveSites.list.clearFilters")}`}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary bg-primary-tint px-3 text-sm font-medium text-primary"
              >
                {pill.label}
                <DiveDayIcon name="close" className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
