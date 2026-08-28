import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { counterQueuePath } from "../focus";

/**
 * **The day's other boats, one tap away** — ADR
 * 20260827-clearwater-surface-language, decision 9.
 *
 * The counter is one instrument pointed at one departure, so the rest of the
 * day is a strip of chips above it rather than four stacked lists competing
 * for the same screen. They are real links carrying `?trip=`, not client
 * state: the focus has to survive a bookmark, a back button, and — the case
 * that made it a URL — a `?notice=` redirect landing back on the boat the
 * staffer was working (`../focus.ts`).
 *
 * `SegmentedControl` is the app's one spelling of this control and brings the
 * 44px floor, the wrap-never-scroll rule and `aria-current` with it. Nothing
 * here re-draws it; this component owns exactly one rule the control cannot
 * know:
 *
 * **A single departure renders nothing.** A control offering no choice is
 * chrome doing the content's job — the whole queue below it is already that
 * one boat, and its title is already the group header.
 *
 * The second is that **the phone chip is the time, and the title is still
 * there**. A chip's label is `whitespace-nowrap` by the control's own
 * contract, and "8:00 AM · Deep Wreck Charter — the Duane on EANx" is wider
 * than a 390px phone: it ran off the edge of its own pill, and no truncation
 * catches it, because a flex item will not shrink below `whitespace-nowrap`
 * content. So below `sm` the title is `sr-only` — out of the pixels, still in
 * the accessible name and still read aloud — and the four boats collapse to a
 * row of times, which is what a staffer scans for anyway. The focused boat's
 * title is the heading immediately beneath.
 *
 * **Any chip that is not today's wears its weekday.** The arrivals window runs
 * six hours back and thirty-six forward, so from about 21:00 on a Monday it
 * holds Tuesday's 08:00 boat and Wednesday's — and with the title hidden below
 * `sm`, those were two identical "8:00 AM" pills on a phone, one tap apart, with
 * a plausible head count behind the wrong one. A weekday is unambiguous across a
 * span that short and arrives already localized (`formatDayParts`, in the shop's
 * own zone), so this needs no copy of its own; the page decides which chips get
 * one, because "the shop's today" is a question about the shop's timezone.
 *
 * The separator lives inside the title's own text rather than in a CSS gap,
 * because a gap is not a space: split into two flex children the accessible
 * name came out "7:00 AMMolasses & French". The gap beside it is a margin,
 * because whitespace at the start of a flex item collapses — a leading space
 * in the text rendered as no space at all.
 */
export function DepartureChips({
  ariaLabel,
  shopSlug,
  departures,
  focusedTripId,
}: {
  ariaLabel: string;
  shopSlug: string;
  /**
   * Every departure the queue holds, in clock order, already worded. `day` is
   * the localized weekday for a boat that is not on the shop's today, and null
   * for one that is.
   */
  departures: readonly { tripId: string; time: string; day: string | null; title: string }[];
  focusedTripId: string;
}) {
  if (departures.length < 2) return null;
  return (
    <SegmentedControl
      ariaLabel={ariaLabel}
      currentKey={focusedTripId}
      currentIsLink
      ariaCurrentValue="true"
      scroll={false}
      className="mt-6"
      items={departures.map((departure) => ({
        key: departure.tripId,
        label: (
          <span className="flex min-w-0 items-baseline">
            {/* A margin rather than a trailing space, for the reason the title
                below uses one: whitespace at the edge of a flex item collapses. */}
            {departure.day ? <span className="me-1">{departure.day}</span> : null}
            <span className="tabular-nums">{departure.time}</span>
            <span className="sr-only sm:not-sr-only sm:ms-1 sm:truncate">{`· ${departure.title}`}</span>
          </span>
        ),
        href: counterQueuePath(shopSlug, departure.tripId),
      }))}
    />
  );
}
