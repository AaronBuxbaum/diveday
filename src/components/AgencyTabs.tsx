import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * Which agency's half of the catalog is showing — the diver-facing catalog
 * (`/s/<slug>/courses`).
 *
 * The staff roster wore this too until slice 9g of ADR
 * 20260827-the-shops-shelves: a shop looking at its own catalog is looking for
 * everything it teaches, so agency became a *group heading* over one ledger
 * there rather than a filter that hides the other ladder. A diver is choosing
 * between ladders rather than surveying them, so the tabs stay on the public
 * page.
 *
 * This replaced a per-row PADI/SSI pill. A pill on every row spent a badge of
 * visual weight repeating what is, in a shop's catalog, one of two answers —
 * and it answered a question ("which agency?") without offering the action that
 * always follows it ("show me only those"). A tab strip is the same fact turned
 * into a control: one line at the top, and the row it decorated gets its width
 * back for the course title.
 *
 * Server-rendered from `?agency=` onto the shared `SegmentedControl`, the same
 * track-and-pill the trip tabs, waiver tabs, checkpoint row, and the shop
 * home's queue switch wear: each tab is a real link to a real URL, so it
 * bookmarks, opens in a new tab, and needs no JavaScript — and, like that
 * switch, `scroll={false}` keeps a tab change from throwing a staffer back to
 * the top of the roster. Both halves of the catalog are views of the *same*
 * page rather than sibling routes, so the current tab stays a clickable link
 * (`currentIsLink`) marked `aria-current="true"` rather than `"page"`.
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
  /**
   * The agencies present in the catalog this strip sits above — the publicly
   * visible part of it (`activeCourseAgencies`). Never a constant pair:
   * `courses.agency` is free text a CSV import can carry anything into.
   */
  agencies: string[];
  /** The selected agency — always one of `agencies`; there is no unfiltered view. */
  current: string | null;
  hrefFor: (agency: string) => string;
  copy: { label: string };
}) {
  // One agency is not a filter — the only tab would show the list that is
  // already on screen.
  if (agencies.length < 2) return null;

  // No "All" tab. A shop teaches to one agency's standards at a time: both
  // lists read in *progression order*, the order a diver actually moves
  // through the certifications, and that order only means anything inside one
  // agency's ladder. "All" interleaved two ladders into a single column where
  // an Open Water sat next to an Open Water, and the reader had to read the
  // row twice to tell which was which — a list nobody wanted, occupying the
  // tab every visitor lands on first. `agencies` covers the whole catalog
  // between them (`courses.agency` is non-null), so nothing is unreachable
  // without it.
  //
  // An agency code is shop data (a proper noun), never copy: upper-cased here
  // rather than translated.
  const tabs = agencies.map((agency) => ({
    key: agency,
    label: agency.toUpperCase(),
    href: hrefFor(agency),
  }));

  return (
    <SegmentedControl
      ariaLabel={copy.label}
      items={tabs}
      currentKey={current}
      currentIsLink
      ariaCurrentValue="true"
      scroll={false}
      className="mt-6"
    />
  );
}
