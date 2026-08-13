import { SegmentedControl } from "@/components/ui/SegmentedControl";

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
    // The shared segmented track: a `nav` of real links, not a `role="group"`
    // of buttons, so each view opens in a new tab, bookmarks, and works
    // without JavaScript. The current view stays a clickable link (a re-tap
    // is a harmless reload of the same URL) and `scroll={false}` holds the
    // reader's place, since both views are the same page. This used to be a
    // fourth hand-rolled `rounded-full` variant of the track; it now wears
    // the same grammar as the trip tabs, the waiver tabs, and the manifest's
    // checkpoint row. (`AgencyTabs` still hand-rolls the old `rounded-full`
    // shape — see FU-20260813-convert-agency-tabs.)
    <SegmentedControl
      ariaLabel={copy.label}
      items={options.map((option) => ({
        key: option.view,
        label: option.label,
        href: hrefFor(option.view),
      }))}
      currentKey={current}
      currentIsLink
      ariaCurrentValue="true"
      scroll={false}
      className="shrink-0"
    />
  );
}
