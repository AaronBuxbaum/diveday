import Link from "next/link";
import { FilterChipsScroller } from "@/components/ui/FilterChipsScroller";

/**
 * Canonical view links above a filtered list. Each chip is a real URL link,
 * and the current view is named with `aria-current`, so filters work with
 * browser history, new tabs, and before hydration. Keep this a quiet view
 * control, not a primary action; its 44px target has a centered label.
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
      ? // Keep the selected view legible on both page and card backgrounds.
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
  const activeChip = chips.find((chip) => chip.active);
  return (
    <>
      {/* Paper needs the list's scope, not the navigation to other views. */}
      {activeChip ? (
        <p className={`hidden text-sm font-medium print:block ${className}`}>{activeChip.label}</p>
      ) : null}
      <nav aria-label={label} className={`print:hidden ${className}`}>
        {/* Keep one horizontally scrolling row on phones and wrap from `sm`.
          The inner scroller owns focus-ring clearance and edge fades; the nav
          owns caller spacing. Its scroll padding keeps focused chips clear of
          the clipping edge, and `FilterChipsScroller` brings the current chip
          into view on arrival. See the scroller and `globals.css` for those
          behaviors. */}
        <FilterChipsScroller
          activeKey={activeChip?.key}
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
    </>
  );
}
