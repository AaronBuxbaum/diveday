import Link from "next/link";

/**
 * How the shop home's one work queue is read: ranked by urgency, or grouped by
 * the departure each job holds up.
 *
 * This is a **state toggle, not two buttons** (design principle 8). Both views
 * answer "who can't board yet" from the same evidence over the same window —
 * Not ready was never a different question, only a different sort, which is
 * why it was a whole second route for so long. The switch replaces that route:
 * exactly one of the two views is on screen at a time, and the other is one tap
 * away in the same place rather than a nav hunt.
 *
 * Server-rendered from `?view=`, so it needs no JavaScript, survives a
 * bookmark, and cannot fork the page's data client-side.

 */
export type QueueView = "urgency" | "departures";

export function isQueueView(value: string | undefined): value is QueueView {
  return value === "urgency" || value === "departures";
}

export type QueueViewSwitchCopy = {
  /** Accessible name for the group of options. */
  label: string;
  urgency: string;
  departures: string;
};

export function QueueViewSwitch({
  current,
  hrefFor,
  copy,
}: {
  current: QueueView;
  /** Builds the URL that selects a view, so the caller owns the query shape. */
  hrefFor: (view: QueueView) => string;
  copy: QueueViewSwitchCopy;
}) {
  const options: { view: QueueView; label: string }[] = [
    { view: "urgency", label: copy.urgency },
    { view: "departures", label: copy.departures },
  ];
  return (
    // A `nav`, not a `role="group"` of buttons: each option is a real link to a
    // real URL, so it opens in a new tab, bookmarks, and works without
    // JavaScript. `min-h-11` on each option — this is tapped on a phone at a
    // counter, so both halves clear the 44px target the design principles set
    // for wet fingers.
    <nav
      aria-label={copy.label}
      className="inline-flex shrink-0 rounded-full border border-border bg-surface-sunken p-1"
    >
      {options.map((option) => {
        const active = option.view === current;
        return (
          <Link
            key={option.view}
            href={hrefFor(option.view)}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
              active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
