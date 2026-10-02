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
    <nav aria-label={label} data-section-tabs className="mb-6 print:hidden">
      <ul className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const active = tab.id === current;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
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

/** The tabs as a `loading.tsx` draws them: 44px tabs on the rule. */
export function SectionTabsSkeleton({ count }: { count: number }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-border">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with no identity
        <div key={index} className="flex min-h-11 items-center px-3">
          <div className="h-4 w-12 rounded bg-surface-sunken" />
        </div>
      ))}
    </div>
  );
}
