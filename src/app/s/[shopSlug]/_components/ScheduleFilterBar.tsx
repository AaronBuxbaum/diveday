import { FilterChips } from "@/components/ui/FilterChips";
import type { DiverTranslator } from "@/i18n/messages";
import { ScheduleFilters } from "./ScheduleFilters";
import { scheduleFilterCopy } from "./schedule-view";

type Lens = { id: string; slug: string; name: string };

/**
 * The filter form directly before the departure list, with the shop's lens chips inside it. The
 * URL carries the filters and the list re-renders server-side (ADR 20260812-javascript-is-required).
 * The lens chips stay visible on phones; the disclosure holds the advanced controls.
 * The form must stay directly before the list: `e2e/schedule-filters.spec.ts` and
 * `e2e/trip-admission.spec.ts` address the departures as `form + ul`. None of it renders in the
 * frame (issue #805): `FilterChips` is a `<nav>` landmark and the frame promises the host page none.
 */
export function ScheduleFilterBar({
  month,
  partySize = 1,
  lenses,
  activeLens,
  lensHref,
  tripTypeFilter,
  hasSpaceFilter,
  canDiveFilter,
  hideAboveFilter,
  t,
}: {
  month: string | null;
  partySize?: number;
  lenses: readonly Lens[];
  activeLens: Lens | undefined | null;
  lensHref: (slug: string | null) => string;
  tripTypeFilter: string | null;
  hasSpaceFilter: boolean;
  canDiveFilter: Parameters<typeof ScheduleFilters>[0]["canDiveFilter"];
  hideAboveFilter: boolean;
  t: DiverTranslator;
}) {
  return (
    <ScheduleFilters
      partySize={partySize}
      month={month}
      lens={activeLens?.slug ?? null}
      tripTypeFilter={tripTypeFilter}
      hasSpaceFilter={hasSpaceFilter}
      canDiveFilter={canDiveFilter}
      hideAboveFilter={hideAboveFilter}
      copy={scheduleFilterCopy(t)}
      chips={
        lenses.length > 0 ? (
          <FilterChips
            label={t("schedule.lenses.railLabel")}
            chips={[
              {
                key: "all",
                href: lensHref(null),
                active: !activeLens,
                label: t("schedule.lenses.all"),
              },
              // The shop's own word, verbatim and untranslated.
              ...lenses.map((entry) => ({
                key: entry.slug,
                href: lensHref(entry.slug),
                active: activeLens?.id === entry.id,
                label: entry.name,
              })),
            ]}
          />
        ) : null
      }
    />
  );
}
