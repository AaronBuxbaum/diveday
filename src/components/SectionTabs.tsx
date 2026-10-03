import Link from "next/link";

/**
 * **A section's parts, as tabs under its title** — ADR 20261001-logbook, the
 * one page shape: a title, at most one primary action, optional tabs, content.
 *
 * Plain links, each a page of its own, so a tab is a URL a staffer can share
 * and the back button walks them. The current one carries `aria-current`.
 * One tab is no choice at all, so fewer than two draws nothing. A component
 * takes its words as props.
 */
export type SectionTab = { id: string; href: string; label: string };

/**
 * **Every tab is the same width** (Aaron, 2026-10-03: Money's "Discount codes"
 * tab was wider than "Orders", so the targets jumped as you moved along).
 *
 * The list is a grid of `1fr` columns floored at their content. From `sm` up
 * it is as wide as it needs (`w-fit`), which sizes every column to the widest
 * tab. On a phone it spans the row and splits it evenly; a label too long for
 * its share keeps its own width rather than clipping, and the rest stay equal.
 * The rule under the tabs runs the full width either way, so it sits on the
 * `<nav>`, and the current tab's underline sits on top of it.
 *
 * The departure's own tabs (`TripTabs`) wear these same two classes.
 */
export const SECTION_TAB_LIST_CLASS =
  "grid grid-flow-col auto-cols-[minmax(min-content,1fr)] sm:w-fit";

export function sectionTabClass(active: boolean): string {
  return `-mb-px flex min-h-11 items-center justify-center whitespace-nowrap border-b-2 px-2 text-sm font-medium sm:px-4 ${
    active
      ? "border-primary text-foreground"
      : "border-transparent text-muted hover:text-foreground"
  }`;
}

export function SectionTabs({
  label,
  tabs,
  current,
}: {
  /** The tab strip's accessible name. */
  label: string;
  tabs: readonly SectionTab[];
  /** The `id` of the tab this page is. */
  current: string;
}) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} data-section-tabs className="mb-6 border-b border-border print:hidden">
      <ul className={SECTION_TAB_LIST_CLASS}>
        {tabs.map((tab) => {
          const active = tab.id === current;
          return (
            <li key={tab.id} className="flex">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`grow ${sectionTabClass(active)}`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The tabs as a `loading.tsx` draws them: 44px tabs of one width on the rule.
 * From `sm` up each cell takes the width a typical widest label needs
 * ("Discount codes", "Date requests"), so the placeholders sit where the
 * loaded tabs will rather than bunched at the left.
 */
export function SectionTabsSkeleton({ count }: { count: number }) {
  return (
    <div data-section-tabs className="mb-6 border-b border-border">
      <div className={SECTION_TAB_LIST_CLASS}>
        {Array.from({ length: count }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with no identity
          <div key={index} className="flex min-h-11 items-center justify-center px-2 sm:min-w-32 sm:px-4">
            <div className="h-4 w-16 rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
    </div>
  );
}
