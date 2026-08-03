"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { DiverFilter, listDiverSummaries } from "@/db/divers";
import { fill, pluralForm } from "@/i18n/fill";

type DiverPage = Awaited<ReturnType<typeof listDiverSummaries>>;
type DiverSummary = DiverPage["divers"][number];

/**
 * Every value is a plain string — never a function. This is a client
 * component with its own client-side-only state (the search text), so the
 * translated copy is fully resolved server-side and handed down as plain
 * data; no translator ever crosses the Server->Client boundary.
 * Count-driven text is a translated `{ one, other }` pair, picked and filled
 * at render time via `pluralForm()`/`fill()` (`@/i18n/fill`).
 */
export interface DiverListCopy {
  viewAllDivers: string;
  viewDivingToday: string;
  viewNeedsAttention: string;
  viewMissingContact: string;
  viewsAriaLabel: string;
  peopleHeading: string;
  /** Already pluralised for the count the badge carries — never a bare digit. */
  peopleCountLabel: string;
  searchHintText: string;
  searchDiversLabel: string;
  searchPlaceholder: string;
  noDiversMatchView: string;
  noDiversOnFile: string;
  tryDifferentSearch: string;
  addOneHere: string;
  emptyAddAction: string;
  emptyShowAll: string;
  emptyImportBody: string;
  emptyImportAction: string;
  noContactDetails: string;
  cardCountOne: string;
  cardCountOther: string;
  pendingReviewText: string;
  toConfirmText: string;
  noneText: string;
  tableHeaderPerson: string;
  tableHeaderCards: string;
  tableHeaderAttention: string;
}

function initials(fullName: string): string {
  return fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function pendingCount(diver: DiverSummary): number {
  return diver.pendingCertificationCount + diver.pendingSpecialtyOrNitroxCount;
}

/** Imported cards are already valid; this is the soft one-tap-confirm nudge. */
function confirmCount(diver: DiverSummary): number {
  return diver.importedUnconfirmedCount;
}

function cardCount(diver: DiverSummary): number {
  return diver.certificationCount + diver.specialtyCount + diver.nitroxCertificationCount;
}

/**
 * The divers list filters live as you type — the input drives the URL's `?q=`
 * (debounced) and the server answers with the matching page, so the roster
 * scales to thousands of records without shipping them all to the browser.
 * Pages are `?page=` links, so back/forward and sharing keep working — and,
 * unlike the forward-only cursor this replaced, so does going back one page.
 */
export function DiverList({
  page,
  shopSlug,
  query,
  filter,
  locale,
  importHref,
  copy,
  pager,
}: {
  page: DiverPage;
  shopSlug: string;
  query: string;
  filter: DiverFilter;
  locale: string;
  /** Where a bulk import lives, or null when this staffer may not run one. */
  importHref: string | null;
  copy: DiverListCopy;
  /**
   * The roster's `<Pager>`, rendered by the Server Component above this one.
   * Staff copy never crosses to the client (`src/i18n/staff-messages.ts`), so
   * the shared pager stays a Server Component and arrives as an element rather
   * than as four more strings on `copy`.
   */
  pager?: React.ReactNode;
}) {
  const cardCountText = (count: number) =>
    fill(pluralForm(count, { one: copy.cardCountOne, other: copy.cardCountOther }, locale), {
      count,
    });
  // The three questions the counter asks of the roster, in the order a day
  // runs: who is on a boat today, whose paperwork needs a staffer, and who
  // still owes a safety contact. Each is a server-side WHERE clause
  // (`DiverFilter`, src/db/divers.ts), so a chip narrows the count and the
  // page together.
  const VIEWS: { label: string; filter: DiverFilter }[] = [
    { label: copy.viewAllDivers, filter: "all" },
    { label: copy.viewDivingToday, filter: "diving_today" },
    { label: copy.viewNeedsAttention, filter: "needs_attention" },
    { label: copy.viewMissingContact, filter: "missing_contact" },
  ];
  const router = useRouter();
  const pathname = usePathname();
  const [typed, setTyped] = useState(query);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the input in sync when navigation (back/forward, a view chip) changes
  // the query underneath us — but never while the user is mid-debounce.
  useEffect(() => setTyped(query), [query]);
  useEffect(() => () => clearTimeout(debounce.current ?? undefined), []);

  // One place builds every roster URL, so search, a view chip, and the pager all
  // carry both the text query and the active filter (never dropping one).
  const hrefFor = useCallback(
    (nextQuery: string, nextFilter: DiverFilter) => {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (nextFilter !== "all") params.set("filter", nextFilter);
      return params.size ? `${pathname}?${params}` : pathname;
    },
    [pathname],
  );

  /**
   * Drop any keystroke that has not reached the URL yet.
   *
   * Every link out of this component already encodes the view *and* the search
   * it means, so once one is followed the pending timer has nothing left to
   * say — and letting it fire is actively wrong: it was scheduled against the
   * view that was on screen when the key was pressed, so 250ms later it would
   * replace the URL with the view the staffer had just left. Clearing the box
   * and tapping a chip inside that window silently undid the tap, and the next
   * search then ran under the wrong view (e2e/roster-views.spec.ts caught this
   * as an intermittent failure).
   */
  const cancelPendingSearch = () => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = null;
  };

  const search = (value: string) => {
    setTyped(value);
    cancelPendingSearch();
    debounce.current = setTimeout(() => {
      router.replace(hrefFor(value, filter), { scroll: false });
    }, 250);
  };

  /**
   * The empty state's door to the add-diver form. That form is a collapsed
   * `<details id="add-diver">` further up this page, so a bare `#add-diver`
   * anchor would jump to a summary that is still shut — the fix is to open it,
   * bring it into view, and put the cursor in the first field, which is what a
   * staffer clicking the button meant. Wired here rather than re-rendering
   * the form inside the card so there is still exactly one add form on the page.
   */
  const openAddDiver = () => {
    const details = document.getElementById("add-diver");
    if (!(details instanceof HTMLDetailsElement)) return;
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "start" });
    details.querySelector<HTMLInputElement>('input[name="fullName"]')?.focus({
      preventScroll: true,
    });
  };

  const { divers } = page;
  /** A search box or a view chip is on, so "nothing here" is a filter result. */
  const narrowed = Boolean(query) || filter !== "all";
  const chipClass = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-muted hover:bg-surface-sunken hover:text-foreground"
    }`;

  return (
    <section className="mt-10" aria-labelledby="diver-list-heading">
      <nav aria-label={copy.viewsAriaLabel} className="mb-4 flex flex-wrap items-center gap-2">
        {VIEWS.map((view) => (
          <Link
            key={view.filter}
            // `typed`, not `query`: the chip carries what is in the box right
            // now, not the last search that reached the URL. Built from `query`
            // it re-applied a search the staffer had just cleared but whose
            // debounce had not landed yet.
            href={hrefFor(typed, view.filter)}
            scroll={false}
            onClick={cancelPendingSearch}
            className={chipClass(filter === view.filter)}
          >
            {view.label}
          </Link>
        ))}
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {/* The count belongs to this heading — it is how many people are in
              the list below, under whichever view is on. It used to hang off
              the page header several sections up, where it read as a stray
              number with nothing to attach to. */}
          <h2 id="diver-list-heading" className="flex items-center gap-2 text-lg font-semibold">
            {copy.peopleHeading}
            <Badge tone="primary" tabularNums>
              <span aria-hidden="true">{page.total}</span>
              <span className="sr-only">{copy.peopleCountLabel}</span>
            </Badge>
          </h2>
          {query ? null : <p className="mt-1 text-sm text-muted">{copy.searchHintText}</p>}
        </div>
        <div className="w-full sm:w-80">
          <label className="sr-only" htmlFor="diver-search">
            {copy.searchDiversLabel}
          </label>
          <input
            id="diver-search"
            type="search"
            value={typed}
            onChange={(event) => search(event.target.value)}
            placeholder={copy.searchPlaceholder}
            className={`${controlClass} min-w-0`}
          />
        </div>
      </div>
      {divers.length === 0 ? (
        <EmptyState className="mt-4">
          <p className="font-medium">{narrowed ? copy.noDiversMatchView : copy.noDiversOnFile}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {narrowed ? copy.tryDifferentSearch : copy.addOneHere}
          </p>
          {/* Narrowed to nothing and empty on day one are different problems,
              so they get different doors: widen the view, or start the roster. */}
          {narrowed ? (
            <Link
              href={hrefFor("", "all")}
              scroll={false}
              // Same reasoning as the view chips: this link clears the search
              // and the view together, so a pending keystroke must not land
              // afterwards and put half of it back.
              onClick={cancelPendingSearch}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {copy.emptyShowAll}
            </Link>
          ) : (
            <>
              <button
                type="button"
                onClick={openAddDiver}
                className={buttonClass({ className: "mt-4" })}
              >
                {copy.emptyAddAction}
              </button>
              {importHref ? (
                <>
                  <p className="mx-auto mt-5 max-w-md text-sm text-muted">{copy.emptyImportBody}</p>
                  <Link
                    href={importHref}
                    className={buttonClass({
                      variant: "secondary",
                      size: "sm",
                      className: "mt-2",
                    })}
                  >
                    {copy.emptyImportAction}
                  </Link>
                </>
              ) : null}
            </>
          )}
        </EmptyState>
      ) : (
        <>
          {/* Phone: stacked cards, so nothing hides behind a sideways scroll. */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {divers.map((diver) => (
              <li key={diver.person.id}>
                <Link
                  href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                  className="block rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:bg-surface-sunken"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {initials(diver.person.fullName)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{diver.person.fullName}</span>
                      <span className="block truncate text-sm text-muted">
                        {diver.person.email ?? diver.person.phone ?? copy.noContactDetails}
                      </span>
                    </span>
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="primary" className="whitespace-nowrap">
                      {cardCountText(cardCount(diver))}
                    </Badge>
                    {pendingCount(diver) > 0 ? (
                      <Badge tone="warning">
                        {fill(copy.pendingReviewText, { count: pendingCount(diver) })}
                      </Badge>
                    ) : null}
                    {confirmCount(diver) > 0 ? (
                      <Badge tone="neutral">
                        {fill(copy.toConfirmText, { count: confirmCount(diver) })}
                      </Badge>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="relative mt-4 hidden overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm sm:block">
            <table className="w-full min-w-180 border-collapse text-left">
              <thead className="bg-surface-sunken text-xs tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {copy.tableHeaderPerson}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {copy.tableHeaderCards}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {copy.tableHeaderAttention}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {divers.map((diver) => (
                  <tr
                    key={diver.person.id}
                    className="group relative transition-colors duration-200 hover:bg-surface-sunken"
                  >
                    <td className="relative px-4 py-3">
                      <Link
                        href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                        className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-primary"
                      >
                        <span
                          className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-semibold text-primary"
                          aria-hidden="true"
                        >
                          {initials(diver.person.fullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold group-hover:text-primary">
                            {diver.person.fullName}
                            <span
                              aria-hidden="true"
                              className="ml-1 opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              →
                            </span>
                          </p>
                          <p className="truncate text-sm font-normal text-muted">
                            {diver.person.email ?? diver.person.phone ?? copy.noContactDetails}
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Badge tone="primary" className="whitespace-nowrap">
                        {cardCountText(cardCount(diver))}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        {pendingCount(diver) > 0 ? (
                          <Badge tone="warning">
                            {fill(copy.pendingReviewText, { count: pendingCount(diver) })}
                          </Badge>
                        ) : null}
                        {confirmCount(diver) > 0 ? (
                          <Badge tone="neutral">
                            {fill(copy.toConfirmText, { count: confirmCount(diver) })}
                          </Badge>
                        ) : null}
                        {pendingCount(diver) === 0 && confirmCount(diver) === 0 ? (
                          <span className="text-muted">{copy.noneText}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {pager}
    </section>
  );
}
