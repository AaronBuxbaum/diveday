import { SectionTabs } from "@/components/SectionTabs";

/**
 * **Schedule is one place with three views** — ADR 20261001-logbook: the week of
 * departures, the same week by who is crewing it, and the tab where shifts and
 * days away are added. Staffing used to be its
 * own page with its own heading; it is the Crew view now, one tap from the
 * week it is about.
 *
 * Both views read `?week=`, so switching keeps the reader on the week they
 * were looking at. A staff component takes its words as props.
 */
export const SCHEDULE_VIEWS = ["week", "crew", "plan"] as const;

export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

export type ScheduleViewsCopy = { label: string } & Record<ScheduleView, string>;

export function scheduleViewHref(shopSlug: string, view: ScheduleView, week?: string): string {
  const path = view === "week" ? `/shop/${shopSlug}/schedule/board` : `/shop/${shopSlug}/staffing`;
  const params = [
    view === "plan" ? "view=plan" : null,
    week ? `week=${encodeURIComponent(week)}` : null,
  ].filter(Boolean);
  return params.length > 0 ? `${path}?${params.join("&")}` : path;
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
  return <SectionTabs pending count={SCHEDULE_VIEWS.length} />;
}
