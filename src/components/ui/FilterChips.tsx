import Link from "next/link";
import { FilterChipsScroller } from "@/components/ui/FilterChipsScroller";

/**
 * Canonical view-narrowing chip row for a filtered staff list.
 *
 * Three hand-rolled copies of this control grew up independently — the divers
 * roster's `chipClass`, the reviews page's primary/secondary `buttonClass`
 * flip, and the trip roster's `filterChipClass` — three visual grammars for
 * the one act of narrowing a list. This is the one vocabulary: a pill row
 * where the active view is tinted and named (`aria-current`), and every chip
 * is a real link to a real URL, so a view bookmarks, opens in a new tab, and
 * works before hydration.
 *
 * A chip is a *view* of the list below it, never the page's action — it never
 * wears button weight. `min-h-11` keeps the dock-test floor (these rows are
 * tapped one-handed on a phone), and `inline-flex items-center` centers the
 * label in that floor (docs/design/forms-and-controls.md).
 */
export interface FilterChip {
  /** Stable identity for the view (the filter value, not the label). */
  key: string;
  href: string;
  active: boolean;
  label: string;
}

const chipClass = (active: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap pressable ${
    active
      ? // `-tint` rather than `bg-primary/10`: translucent, the selected pill
        // contrasts against the page behind it, which on `/divers` and
        // `/reviews` is `--background` rather than a card — 4.45:1, missing AA
        // by 0.05 on the one control that says which view you are looking at
        // (issue #793). The opaque token is 4.67:1 anywhere.
        "border-primary bg-primary-tint text-primary"
      : "border-border text-muted hover:bg-surface-sunken hover:text-foreground"
  }`;

export function FilterChips({
  label,
  chips,
  className = "",
  onNavigate,
}: {
  /** Accessible name for the row, from the caller's message bundle. */
  label: string;
  chips: FilterChip[];
  className?: string;
  /**
   * Fired when any chip is followed — for a client caller with in-flight
   * state to drop before the URL changes (the divers roster cancels its
   * pending search debounce here). Server callers omit it.
   */
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={label} className={className || undefined}>
      {/* One row that scrolls on a phone, wrapping only from `sm` up. Eleven
          gear kinds wrapped to four rows at 390px and pushed the list they
          narrow below the fold; a row a thumb can flick through keeps the
          control one line tall at every width. The negative margin lets the
          row bleed to the screen edge, so a chip past it is cut by the
          screen rather than by the page's gutter.

          A scroll box clips both axes, and the chips sat flush with its top
          and bottom, so the focus ring's 5px went on both (every filtered
          list at 390px). `py-1.5` gives it room and `-my-1.5` takes the
          room back, so nothing around the row moves. That is also why the
          scroller is its own box inside the nav: a caller's `mb-5` on the
          same element would lose to the negative margin.

          A chip peeking in from the edge cannot be the row's affordance,
          because whether one peeks depends on the labels: at 390 "Wrecks"
          ended at 386 and the next chip started off screen, so the row read
          as complete. `chip-scroller` is the affordance: it fades whichever
          end has more to show, animated on the row's own scroll so the last
          chip and its ring are whole once the row reaches its end
          (globals.css).

          `scroll-px-6` is where a focused chip is scrolled to: the 16px fade
          and the ring's 5px reach clear of the row's end. Without it
          "Wrecks", whole on screen 3.6px from the edge, took focus where it
          stood and its ring lost 1.5px to the row's clip. The pixel probe
          forces `:focus-visible` without the scroll a real focus makes, so
          it still sees that one cut (scripts/pixel-probe-settled.json).

          `FilterChipsScroller` scrolls the row so the current chip is on
          screen when the row arrives: a view whose chip sits past the edge
          loaded with nothing naming it. */}
      <FilterChipsScroller
        activeKey={chips.find((chip) => chip.active)?.key}
        className="chip-scroller flex items-center gap-2 max-sm:-mx-4 max-sm:-my-1.5 max-sm:scroll-px-6 max-sm:overflow-x-auto max-sm:px-4 max-sm:py-1.5 max-sm:[scrollbar-width:none] sm:flex-wrap"
      >
        {chips.map((chip) => (
          <Link
            key={chip.key}
            href={chip.href}
            // The chips sit above the list they narrow; a scroll reset would
            // throw the reader back to the top of the page on every view change.
            scroll={false}
            onClick={onNavigate}
            aria-current={chip.active ? "true" : undefined}
            className={chipClass(chip.active)}
          >
            {chip.label}
          </Link>
        ))}
      </FilterChipsScroller>
    </nav>
  );
}
