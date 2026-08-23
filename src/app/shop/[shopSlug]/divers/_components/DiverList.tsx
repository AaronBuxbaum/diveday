"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { FilterChips } from "@/components/ui/FilterChips";
import { controlClass } from "@/components/ui/form";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import type { DiverFilter, listDiverSummaries } from "@/db/divers";
import { fill } from "@/i18n/fill";
import type { CertificationLevel } from "@/lib/readiness";

type DiverPage = Awaited<ReturnType<typeof listDiverSummaries>>;
type DiverSummary = DiverPage["divers"][number];
type QuickAddMode = "hidden" | "entering" | "visible" | "exiting";

/**
 * Every value is a plain string — never a function. This is a client
 * component with its own client-side-only state (the search text), so the
 * translated copy is fully resolved server-side and handed down as plain
 * data; no translator ever crosses the Server->Client boundary.
 * Count-driven text is a translated `{ one, other }` pair, picked and filled
 * at render time via `pluralForm()`/`fill()` (`@/i18n/fill`).
 */
export interface DiverListCopy {
  addDiverLabel: string;
  addDiverWithName: string;
  viewAllDivers: string;
  viewDivingToday: string;
  viewNeedsAttention: string;
  viewMissingContact: string;
  viewRemoved: string;
  viewsAriaLabel: string;
  /** Replaces the search hint under the heading while the Removed view is on. */
  removedNote: string;
  peopleHeading: string;
  /** Already pluralised for the count the badge carries — never a bare digit. */
  peopleCountLabel: string;
  searchHintText: string;
  searchDiversLabel: string;
  searchPlaceholder: string;
  noDiversMatchView: string;
  noDiversOnFile: string;
  addOneHere: string;
  emptyShowAll: string;
  emptyImportBody: string;
  emptyImportAction: string;
  noContactDetails: string;
  /**
   * One word per rung of the certification ladder, already translated — handed
   * down whole from the shop's single level-label source
   * (`CERTIFICATION_LEVEL_KEYS`, `src/i18n/readiness-labels.ts`), the same map
   * the diver record and the trip requirements read. Never a second mapping
   * here: two surfaces that name a diver's level differently is exactly the
   * drift this shape prevents.
   */
  certificationLevels: Record<CertificationLevel, string>;
  /** No verified, unexpired level card on file — see `levelText` below. */
  noCertificationLevel: string;
  pendingReviewText: string;
  toConfirmText: string;
  tableHeaderPerson: string;
  tableHeaderLevel: string;
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

/**
 * What the roster says a diver's level is.
 *
 * `certificationLevel` is already the highest *verified, unexpired* card
 * (`summarizeDivers`, src/db/divers.ts, reading `diverDepthLimit`'s rule) — an
 * expired higher card never outranks a valid lower one, and a card still
 * awaiting review says nothing here. When there is no such card the cell says
 * so in words rather than showing a bare dash: "nothing on file" and "we don't
 * know" have to read differently on a safety-adjacent list. Cards that *are*
 * on file but not yet speaking still raise their badge beside this text.
 */
function levelText(diver: DiverSummary, copy: DiverListCopy): string {
  return diver.certificationLevel
    ? copy.certificationLevels[diver.certificationLevel]
    : copy.noCertificationLevel;
}

/**
 * The divers list filters live as you type — the input drives the URL's `?q=`
 * (debounced) and the server answers with the matching page, so the roster
 * scales to thousands of records without shipping them all to the browser.
 * Pages are `?page=` links, so back/forward and sharing keep working — and,
 * unlike the forward-only cursor this replaced, so does going back one page.
 *
 * **A row carries no actions — it is a link to the record, and nothing else.**
 * The Deleted view used to hang a "Restore" off every row it listed, which put
 * a consequential write on a list a staffer scans rather than reads, one
 * mis-tap from a name they were only looking for. Everything a staffer can do
 * to a diver now lives on that diver's own record, where the person is on
 * screen and the deleted state is stated above the control (`RestoreDiver`).
 */
export function DiverList({
  page,
  shopSlug,
  query,
  filter,
  importHref,
  canRestore,
  quickAddAction,
  copy,
  pager,
}: {
  page: DiverPage;
  shopSlug: string;
  query: string;
  filter: DiverFilter;
  /** Where a bulk import lives, or null when this staffer may not run one. */
  importHref: string | null;
  /**
   * Whether this staffer may restore a deleted diver — owner/manager, the same
   * gate the removal it reverses takes (H-14). It governs the Deleted chip
   * alone: the view exists to *find* a deleted diver, and there is nothing to
   * find there for someone who could not put them back (ADR
   * 20260724-role-gated-surfaces-hide-not-explain). The restore itself is on
   * the record.
   */
  canRestore: boolean;
  /** Quick-creates a diver by query string (name/email/phone) and redirects to edit mode. */
  quickAddAction?: ((formData: FormData) => void) | null;
  copy: DiverListCopy;
  /**
   * The roster's `<Pager>`, rendered by the Server Component above this one.
   * Staff copy never crosses to the client (`src/i18n/staff-messages.ts`), so
   * the shared pager stays a Server Component and arrives as an element rather
   * than as four more strings on `copy`.
   */
  pager?: React.ReactNode;
}) {
  // The three questions the counter asks of the roster, in the order a day
  // runs: who is on a boat today, whose paperwork needs a staffer, and who
  // still owes a safety contact. Each is a server-side WHERE clause
  // (`DiverFilter`, src/db/divers.ts), so a chip narrows the count and the
  // page together.
  //
  // "Deleted" is the fourth, and the one that is not about a day: it is the
  // only way to *find* a soft-deleted diver, who otherwise matches no search
  // and sits in no view. It comes last, visually apart from the working views,
  // and only for a staffer who may restore — the whole reason to go there.
  const VIEWS: { label: string; filter: DiverFilter }[] = [
    { label: copy.viewAllDivers, filter: "all" },
    { label: copy.viewDivingToday, filter: "diving_today" },
    { label: copy.viewNeedsAttention, filter: "needs_attention" },
    { label: copy.viewMissingContact, filter: "missing_contact" },
    ...(canRestore ? [{ label: copy.viewRemoved, filter: "removed" as DiverFilter }] : []),
  ];
  const router = useRouter();
  const pathname = usePathname();
  const [typed, setTyped] = useState(query);
  const [quickAddMode, setQuickAddMode] = useState<QuickAddMode>(
    query.trim() ? "entering" : "hidden",
  );
  // **The roster opens ready to be typed into**, the way check-in does
  // (`check-in/CheckInSearch.tsx`): a staffer arrives here holding a name, and
  // searching is the first thing they do. Focused through a ref rather than the
  // `autoFocus` attribute because biome's `noAutofocus` rule forbids that JSX
  // prop outright — every focus-on-mount in this repo goes the same way.
  const searchRef = useRef<HTMLInputElement>(null);
  const quickAddRef = useRef<HTMLDivElement>(null);
  const quickAddFormRef = useRef<HTMLFormElement>(null);
  const [quickAddShift, setQuickAddShift] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the input in sync when navigation (back/forward, a view chip) changes
  // the query underneath us — but never while the user is mid-debounce: the
  // render that lands here can be the *previous* search's, and syncing to it
  // would resurrect text the user just cleared. The chips build their hrefs
  // from `typed`, so a resurrected value would ride the next tap back into
  // the URL (e2e/roster-views.spec.ts caught this as an intermittent failure).
  useEffect(() => {
    if (debounce.current) return;
    setTyped(query);
    setQuickAddMode(query.trim() ? "visible" : "hidden");
  }, [query]);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  useEffect(() => {
    if (quickAddMode !== "exiting") return;
    const timer = setTimeout(() => setQuickAddMode("hidden"), 250);
    return () => clearTimeout(timer);
  }, [quickAddMode]);
  useLayoutEffect(() => {
    const quickAdd = quickAddRef.current;
    if (quickAddMode === "hidden" || !quickAdd) {
      setQuickAddShift(0);
      return;
    }
    const updateShift = () =>
      setQuickAddShift(Math.ceil(quickAdd.getBoundingClientRect().width + 8));
    updateShift();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateShift);
    observer.observe(quickAdd);
    return () => observer.disconnect();
  }, [quickAddMode]);
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
    setQuickAddMode((mode) =>
      value.trim()
        ? mode === "hidden" || mode === "exiting"
          ? "entering"
          : "visible"
        : mode === "hidden"
          ? "hidden"
          : "exiting",
    );
    cancelPendingSearch();
    debounce.current = setTimeout(() => {
      // Cleared before the replace so the navigation this triggers is free to
      // sync the input again — the timer is no longer "pending" once it fires.
      debounce.current = null;
      router.replace(hrefFor(value, filter), { scroll: false });
    }, 250);
  };

  /**
   * Enter is the fast path past whatever the debounce hasn't caught up to yet.
   * A pending keystroke (`typed !== query`) gets flushed immediately rather
   * than acted on blind — the visible `divers` still answer the *previous*
   * query, so a match count read off them now would be stale. Once the URL
   * is current, one match opens straight to that diver's record; no match at
   * all reaches for the same quick-add the button beside the box already
   * offers, so typing a new name and hitting Enter never requires the mouse.
   */
  const submitSearch = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = typed.trim();
    if (!value) return;
    if (typed !== query) {
      cancelPendingSearch();
      router.replace(hrefFor(typed, filter), { scroll: false });
      return;
    }
    if (page.total === 1 && page.divers[0]) {
      router.push(`/shop/${shopSlug}/divers/${page.divers[0].person.id}`);
      return;
    }
    if (quickAddMode !== "hidden" && quickAddAction) {
      quickAddFormRef.current?.requestSubmit();
    }
  };

  const { divers } = page;
  /** A search box or a view chip is on, so "nothing here" is a filter result. */
  const narrowed = Boolean(query) || filter !== "all";
  /**
   * The views row governs a roster. On day one there is no roster: four chips
   * that all resolve to the same nothing are controls with nothing to control —
   * and they sit above the one thing that helps, the empty card's "Add your
   * first diver". Narrowed-to-nothing is a different state and keeps the row:
   * the chips are how you widen back out.
   */
  const showViews = divers.length > 0 || narrowed;

  return (
    <section className="mt-10" aria-labelledby="diver-list-heading">
      {/* Hidden over a day-one empty roster (see `showViews` above); kept
          whenever a search or chip narrowed the list, so the way back out
          stays on screen. */}
      {showViews ? (
        <FilterChips
          label={copy.viewsAriaLabel}
          className="mb-4"
          // Dropped before the URL changes: a keystroke that has not reached
          // the URL yet was scheduled against the view being left, and letting
          // it land would replace the URL with that stale view (see
          // `cancelPendingSearch`).
          onNavigate={cancelPendingSearch}
          chips={VIEWS.map((view) => ({
            key: view.filter,
            // `typed`, not `query`: the chip carries what is in the box right
            // now, not the last search that reached the URL. Built from `query`
            // it re-applied a search the staffer had just cleared but whose
            // debounce had not landed yet.
            href: hrefFor(typed, view.filter),
            active: filter === view.filter,
            label: view.label,
          }))}
        />
      ) : null}
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
          {/* The Removed view's line says what removal actually means here,
              because the list underneath it looks exactly like the roster and
              nothing else on screen would tell a reader these people are off
              every list. It outranks the search hint, which is the same in
              every view. */}
          {filter === "removed" ? (
            <p className="mt-1 text-sm text-muted">{copy.removedNote}</p>
          ) : (
            <p className="mt-1 text-sm text-muted">{copy.searchHintText}</p>
          )}
        </div>
        <div
          className="flex w-full max-w-full flex-wrap items-center gap-2 max-sm:overflow-x-hidden sm:w-auto"
          style={{ "--quick-add-shift": `${quickAddShift}px` } as CSSProperties}
        >
          <div className="w-full min-w-0 sm:w-80">
            <label className="sr-only" htmlFor="diver-search">
              {copy.searchDiversLabel}
            </label>
            <input
              ref={searchRef}
              id="diver-search"
              type="search"
              value={typed}
              onChange={(event) => search(event.target.value)}
              onKeyDown={submitSearch}
              placeholder={copy.searchPlaceholder}
              className={`${controlClass} min-w-0 ${
                quickAddMode === "exiting"
                  ? "animate-slide-out-right"
                  : quickAddMode === "entering"
                    ? "animate-slide-in-right"
                    : ""
              }`}
            />
          </div>
          {quickAddMode !== "hidden" && quickAddAction ? (
            <div
              ref={quickAddRef}
              className={
                quickAddMode === "exiting"
                  ? "animate-slide-out-right"
                  : quickAddMode === "entering"
                    ? "animate-slide-in-right"
                    : undefined
              }
              onAnimationEnd={() => {
                if (quickAddMode === "exiting") setQuickAddMode("hidden");
                if (quickAddMode === "entering") setQuickAddMode("visible");
              }}
            >
              <form ref={quickAddFormRef} action={quickAddAction} onSubmit={cancelPendingSearch}>
                <input type="hidden" name="query" value={typed.trim()} />
                <SubmitButton
                  pendingLabel={copy.addDiverLabel}
                  className={buttonClass({
                    variant: "primary",
                    className: "whitespace-nowrap",
                  })}
                >
                  {fill(copy.addDiverWithName, { name: typed.trim() })}
                </SubmitButton>
              </form>
            </div>
          ) : null}
        </div>
      </div>
      {divers.length === 0 ? (
        <EmptyState
          className="mt-4"
          title={narrowed ? copy.noDiversMatchView : copy.noDiversOnFile}
          body={narrowed ? null : copy.addOneHere}
          /* Narrowed to nothing and empty on day one are different problems,
             so they get different doors: widen the view, or start the roster. */
          action={
            narrowed ? (
              <Link
                href={hrefFor("", "all")}
                scroll={false}
                // Same reasoning as the view chips: this link clears the search
                // and the view together, so a pending keystroke must not land
                // afterwards and put half of it back.
                onClick={cancelPendingSearch}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {copy.emptyShowAll}
              </Link>
            ) : importHref ? (
              <div className="flex flex-col items-center gap-2">
                <p className="max-w-md text-sm text-muted">{copy.emptyImportBody}</p>
                <Link
                  href={importHref}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {copy.emptyImportAction}
                </Link>
              </div>
            ) : null
          }
        />
      ) : (
        <>
          {/* Phone: stacked cards, so nothing hides behind a sideways scroll. */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {divers.map((diver) => (
              <li key={diver.person.id}>
                <Link
                  href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                  // Same reasoning as the view chips above: a keystroke still
                  // sitting in the debounce was scheduled against the roster,
                  // so letting it fire 250ms after this tap replaces the record
                  // the staffer just opened with the list they just left.
                  onClick={cancelPendingSearch}
                  className={sectionCardClass({
                    className:
                      "block transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:bg-surface-sunken",
                  })}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-tint font-semibold text-primary"
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
                    {/* The level is roster fact, not an alert — muted ink, not
                        a pill. Badges below appear only when a row actually
                        needs a staffer (design principle 9). */}
                    <span className="whitespace-nowrap text-muted">{levelText(diver, copy)}</span>
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
          {/* Desktop: the shared table vocabulary (`@/components/ui/table`) —
              one shell, one header voice, one row divider, one density, shared
              with orders, reports, the departure log and the import preview.
              No `minWidth` floor: this is a three-column table, and the 720px
              floor it used to carry forced a sideways scroll on exactly the
              narrow-desktop widths the phone cards no longer cover. The shell's
              own `overflow-x-auto` stays as the safety net, and `relative` on
              it keeps the stretched row link's positioning context inside the
              card. */}
          <Table shellClassName="relative mt-4 hidden sm:block">
            <THead>
              <Th>{copy.tableHeaderPerson}</Th>
              <Th>{copy.tableHeaderLevel}</Th>
              <Th>{copy.tableHeaderAttention}</Th>
            </THead>
            <TBody>
              {divers.map((diver) => (
                <Tr key={diver.person.id}>
                  {/* `text-base` because the person's name is the row's own
                      voice, not table small print — a directly-applied size
                      beats the shell's inherited `text-sm`. `align-middle`
                      centres this cell's avatar against the taller of the two,
                      as it did before the conversion. */}
                  <Td className="align-middle text-base">
                    <RowLink
                      href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                      onClick={cancelPendingSearch}
                      className="min-w-0 gap-3"
                    >
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-tint font-semibold text-primary"
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
                    </RowLink>
                  </Td>
                  {/* The level is a stable fact column. Attention is separate
                      and always present, so searching never redraws the table
                      shape when a result happens to have no pending work. */}
                  <Td className="align-middle">
                    <span className="whitespace-nowrap text-muted">{levelText(diver, copy)}</span>
                  </Td>
                  <Td className="align-middle">
                    <div className="flex flex-wrap items-center gap-2">
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
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </>
      )}
      {pager}
    </section>
  );
}
