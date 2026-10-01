import Link from "next/link";

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
  current,
  week,
  copy,
}: {
  shopSlug: string;
  current: ScheduleView;
  /** The week on screen, carried to the other view. */
  week?: string;
  copy: ScheduleViewsCopy;
}) {
  return (
    <nav aria-label={copy.label} data-schedule-views className="mb-6 print:hidden">
      <ul className="flex gap-1 border-b border-border">
        {SCHEDULE_VIEWS.map((view) => {
          const active = view === current;
          return (
            <li key={view}>
              <Link
                href={scheduleViewHref(shopSlug, view, week)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {copy[view]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The two views as both views' `loading.tsx` draws them: 44px tabs on the rule. */
export function ScheduleViewsSkeleton() {
  return (
    <div className="mb-6 flex gap-1 border-b border-border">
      {SCHEDULE_VIEWS.map((view) => (
        <div key={view} className="flex min-h-11 items-center px-3">
          <div className="h-4 w-12 rounded bg-surface-sunken" />
        </div>
      ))}
    </div>
  );
}
