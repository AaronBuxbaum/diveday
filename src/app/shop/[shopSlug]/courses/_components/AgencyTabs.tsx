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
 * no JavaScript — and, like that switch, `scroll={false}`
 * keeps a tab change from throwing a staffer back to the top of the roster.
 * The page owns the query shape via `hrefFor` — the tab strip never builds a URL
 * itself, which is what keeps `?page=` from surviving a tab change and
 * stranding a staffer on page 3 of a one-page list.
 *
 * Exactly one agency is on screen at a time; see the note on `tabs` below for
 * why there is no "All".
 */
export function AgencyTabs({
  agencies,
  current,
  hrefFor,
  copy,
}: {
  /** The agencies present in this shop's catalog, from `courseAgencies`. */
  agencies: string[];
  /** The selected agency — always one of `agencies`; there is no unfiltered view. */
  current: string | null;
  hrefFor: (agency: string) => string;
  copy: { label: string };
}) {
  // One agency is not a filter — the only tab would show the list that is
  // already on screen.
  if (agencies.length < 2) return null;

  // No "All" tab. A shop teaches to one agency's standards at a time: the
  // roster reads in *progression order*, the order a diver actually moves
  // through the certifications, and that order only means anything inside one
  // agency's ladder. "All" interleaved two ladders into a single column where
  // an Open Water sat next to an Open Water, and staff had to read the row
  // twice to tell which was which — a list nobody wanted, occupying the tab
  // every shop lands on first. `agencies` covers the whole catalog between
  // them (`courses.agency` is non-null), so nothing is unreachable without it.
  //
  // An agency code is shop data (a proper noun), never copy: upper-cased here
  // rather than translated.
  const tabs = agencies.map((agency) => ({ agency, label: agency.toUpperCase() }));

  return (
    <nav
      aria-label={copy.label}
      className="mt-6 inline-flex shrink-0 rounded-full border border-border bg-surface-sunken p-1"
    >
      {tabs.map((tab) => {
        const active = tab.agency === current;
        return (
          <Link
            key={tab.agency}
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
