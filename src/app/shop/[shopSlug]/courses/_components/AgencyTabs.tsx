import Link from "next/link";

/**
 * Which agency's half of the catalog the roster is showing.
 *
 * This replaced a per-row PADI/SSI pill. A pill on every row spent a badge of
 * visual weight repeating what is, in a shop's catalog, one of two answers —
 * and it answered a question ("which agency?") without offering the action that
 * always follows it ("show me only those"). A tab strip is the same fact turned
 * into a control: one line at the top, and the row it decorated gets its width
 * back for the course title.
 *
 * Server-rendered from `?agency=`, like the shop home's queue switch: each tab
 * is a real link to a real URL, so it bookmarks, opens in a new tab, and needs
 * no JavaScript. The page owns the query shape via `hrefFor` — the tab strip
 * never builds a URL itself, which is what keeps `?page=` from surviving a tab
 * change and stranding a staffer on page 3 of a one-page list.
 */
export function AgencyTabs({
  agencies,
  current,
  hrefFor,
  copy,
}: {
  /** The agencies present in this shop's catalog, from `courseAgencies`. */
  agencies: string[];
  /** The selected agency, or null for "All". */
  current: string | null;
  hrefFor: (agency: string | null) => string;
  copy: { label: string; all: string };
}) {
  // One agency is not a filter — every tab would show the same list, and "All"
  // beside "PADI" is a choice between two identical answers.
  if (agencies.length < 2) return null;

  const tabs: { agency: string | null; label: string }[] = [
    { agency: null, label: copy.all },
    // An agency code is shop data (a proper noun), never copy: it is upper-cased
    // here rather than translated.
    ...agencies.map((agency) => ({ agency, label: agency.toUpperCase() })),
  ];

  return (
    <nav
      aria-label={copy.label}
      className="mt-6 inline-flex shrink-0 rounded-full border border-border bg-surface-sunken p-1"
    >
      {tabs.map((tab) => {
        const active = tab.agency === current;
        return (
          <Link
            key={tab.agency ?? "all"}
            href={hrefFor(tab.agency)}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
              active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
