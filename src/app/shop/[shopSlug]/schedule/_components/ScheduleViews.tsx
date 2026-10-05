import { SectionTabs, SectionTabsSkeleton } from "@/components/SectionTabs";

/**
 * **Schedule is one place with two views** — ADR 20261001-logbook: the week of
 * departures, and the same week by who is crewing it. Staffing used to be its
 * own page with its own heading; it is the Crew view now, one tap from the
 * week it is about.
 *
 * Both views read `?week=`, so switching keeps the reader on the week they
 * were looking at. A staff component takes its words as props.
 */
export const SCHEDULE_VIEWS = ["week", "crew"] as const;

export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

export type ScheduleViewsCopy = { label: string } & Record<ScheduleView, string>;

export function scheduleViewHref(shopSlug: string, view: ScheduleView, week?: string): string {
  const path = view === "week" ? `/shop/${shopSlug}/schedule/board` : `/shop/${shopSlug}/staffing`;
  return week ? `${path}?week=${encodeURIComponent(week)}` : path;
}

export function ScheduleViews({
  shopSlug,
  crewSchedule,
  current,
  week,
  copy,
}: {
  shopSlug: string;
  /**
   * Whether the shop keeps a crew schedule (`shops.crew_schedule_enabled`).
   * Off, there is one view, and one tab is no choice — the row is not drawn.
   */
  crewSchedule: boolean;
  current: ScheduleView;
  /** The week on screen, carried to the other view. */
  week?: string;
  copy: ScheduleViewsCopy;
}) {
  if (!crewSchedule) return null;
  return (
    <SectionTabs
      label={copy.label}
      current={current}
      tabs={SCHEDULE_VIEWS.map((view) => ({
        id: view,
        href: scheduleViewHref(shopSlug, view, week),
        label: copy[view],
      }))}
    />
  );
}

/** The two views as both views' `loading.tsx` draws them. */
export function ScheduleViewsSkeleton() {
  return <SectionTabsSkeleton count={SCHEDULE_VIEWS.length} />;
}
