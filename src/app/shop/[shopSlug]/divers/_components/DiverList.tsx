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
 * component with its own client-side-only state (search text, saved views),
 * so the translated copy is fully resolved server-side and handed down as
 * plain data; no translator ever crosses the Server->Client boundary.
 * Count-driven text is a translated `{ one, other }` pair, picked and filled
 * at render time via `pluralForm()`/`fill()` (`@/i18n/fill`).
 */
export interface DiverListCopy {
  viewAllDivers: string;
  viewMissingContact: string;
  viewInsured: string;
  savedViewsAriaLabel: string;
  namePromptText: string;
  removeSavedViewAriaLabel: string;
  saveThisView: string;
  saveViewConfirm: string;
  saveViewCancel: string;
  savedOnThisDevice: string;
  peopleHeading: string;
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

/**
 * A staffer's own pinned view — a name over a search + filter, stored per shop.
 *
 * These live in this browser's own storage, not on the account. That is a real
 * limitation on a shared counter tablet — one browser reset takes them with it,
 * and the same person's phone starts empty — so the row says so out loud
 * ("Saved on this device") rather than implying a roaming preference the app
 * does not keep. There is no per-account preference store to move them to
 * today; adding one is a schema decision, not a copy fix.
 */
type SavedView = { name: string; query: string; filter: DiverFilter };

function savedViewsKey(shopSlug: string) {
  return `diveday:diver-views:${shopSlug}`;
}

function readSavedViews(shopSlug: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(savedViewsKey(shopSlug));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
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
  const BUILT_IN_VIEWS: { label: string; filter: DiverFilter }[] = [
    { label: copy.viewAllDivers, filter: "all" },
    { label: copy.viewMissingContact, filter: "missing_contact" },
    { label: copy.viewInsured, filter: "insured" },
  ];
  const router = useRouter();
  const pathname = usePathname();
  const [typed, setTyped] = useState(query);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  // Naming a view is an in-page form, never `window.prompt`: the native dialog
  // blocks the tab, ignores the shop's locale and the app's type scale, and on
  // a counter tablet lands as an unstyled system sheet over the roster.
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the input in sync when navigation (back/forward, a view chip) changes
  // the query underneath us — but never while the user is mid-debounce.
  useEffect(() => setTyped(query), [query]);
  useEffect(() => () => clearTimeout(debounce.current ?? undefined), []);
  useEffect(() => setSavedViews(readSavedViews(shopSlug)), [shopSlug]);
  // The field replaces the button it was opened from, so the cursor has to
  // follow — otherwise the tap lands somewhere with nothing focused.
  useEffect(() => {
    if (naming) nameInput.current?.focus();
  }, [naming]);

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

  const search = (value: string) => {
    setTyped(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      router.replace(hrefFor(value, filter), { scroll: false });
    }, 250);
  };

  const closeNaming = () => {
    setNaming(false);
    setViewName("");
  };

  const saveCurrentView = (event: React.FormEvent) => {
    event.preventDefault();
    const name = viewName.trim();
    // Re-saving under an existing name replaces that view rather than pinning a
    // second chip with the same words on it.
    if (!name) return;
    const next = [...savedViews.filter((view) => view.name !== name), { name, query, filter }];
    window.localStorage.setItem(savedViewsKey(shopSlug), JSON.stringify(next));
    setSavedViews(next);
    closeNaming();
  };

  const removeSavedView = (name: string) => {
    const next = savedViews.filter((view) => view.name !== name);
    window.localStorage.setItem(savedViewsKey(shopSlug), JSON.stringify(next));
    setSavedViews(next);
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
  /**
   * The views row governs a roster. On day one there is no roster: three chips
   * that all resolve to the same nothing, plus "Save this view" offering to pin
   * it, are controls with nothing to control — and they sit above the one thing
   * that helps, the empty card's "Add your first diver".
   *
   * Narrowed-to-nothing is a different state and keeps the row: the chips are
   * how you widen back out. So does a device that already has views pinned —
   * they are this staffer's, and silently hiding them would read as lost.
   */
  const showSavedViews = divers.length > 0 || narrowed || savedViews.length > 0;
  const chipClass = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-muted hover:bg-surface-sunken hover:text-foreground"
    }`;

  return (
    <section className="mt-10" aria-labelledby="diver-list-heading">
      {showSavedViews ? (
        <nav
          aria-label={copy.savedViewsAriaLabel}
          className="mb-4 flex flex-wrap items-center gap-2"
        >
          {BUILT_IN_VIEWS.map((view) => (
            <Link
              key={view.filter}
              href={hrefFor(query, view.filter)}
              scroll={false}
              className={chipClass(filter === view.filter)}
            >
              {view.label}
            </Link>
          ))}
          {savedViews.map((view) => {
            const active = view.query === query && view.filter === filter;
            return (
              <span key={view.name} className="inline-flex items-center">
                <Link
                  href={hrefFor(view.query, view.filter)}
                  scroll={false}
                  className={chipClass(active)}
                >
                  {view.name}
                </Link>
                {/* A 44px target with a 24px glyph in it (principle 2's dock
                  test): the box is `size-11` and the negative vertical margin
                  gives the height back to the row, so the × looks exactly as
                  small as before while a wet finger can actually hit it. The
                  horizontal padding is real, not negative — bleeding sideways
                  would put "remove this view" over the last 10px of the chip
                  that *applies* it, and an accidental delete is a worse trade
                  than a slightly wider row. */}
                <button
                  type="button"
                  onClick={() => removeSavedView(view.name)}
                  aria-label={fill(copy.removeSavedViewAriaLabel, { name: view.name })}
                  className="-my-2.5 inline-flex size-11 items-center justify-center rounded-full text-muted hover:text-danger"
                >
                  ×
                </button>
              </span>
            );
          })}
          {naming ? (
            <form onSubmit={saveCurrentView} className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="saved-view-name">
                {copy.namePromptText}
              </label>
              <div className="w-44">
                <input
                  id="saved-view-name"
                  ref={nameInput}
                  type="text"
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  // Escape backs out the way it does out of the ⌘K palette and an
                  // armed InlineConfirm — the one gesture that means "never mind"
                  // everywhere in the app.
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeNaming();
                  }}
                  placeholder={copy.namePromptText}
                  className={`${controlClass} min-w-0`}
                />
              </div>
              <button
                type="submit"
                disabled={!viewName.trim()}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {copy.saveViewConfirm}
              </button>
              <button
                type="button"
                onClick={closeNaming}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                {copy.saveViewCancel}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="inline-flex min-h-9 items-center rounded-full border border-dashed border-border px-3 text-sm font-medium text-muted hover:text-foreground"
            >
              {copy.saveThisView}
            </button>
          )}
          {/* Only once there is something to lose. An empty row saying where
            nothing is stored is noise; a row of pinned views that a browser
            reset would take is worth being honest about. */}
          {savedViews.length > 0 ? (
            <p className="text-sm text-muted">{copy.savedOnThisDevice}</p>
          ) : null}
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="diver-list-heading" className="text-lg font-semibold">
            {copy.peopleHeading}
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
