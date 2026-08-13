import Link from "next/link";

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
  `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary/10 text-primary"
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
    <nav
      aria-label={label}
      className={`flex flex-wrap items-center gap-2${className ? ` ${className}` : ""}`}
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
    </nav>
  );
}
