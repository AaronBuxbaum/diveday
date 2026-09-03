"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/FilterChips";
import { SearchField } from "@/components/ui/form";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { DiverFilter } from "@/db/divers";
import { groupByLetter } from "@/lib/roster-rows";

/**
 * One exceptional thing about a diver, as a pill.
 *
 * `danger` is a blocker — this diver cannot board the departure they are on —
 * and `warning` is a standing invoice or a possible duplicate. Every one
 * carries a word as well as a colour; `Badge` adds the tone's own mark.
 */
export type RosterBadge = { tone: "danger" | "warning"; label: string };

/**
 * **One roster row, fully resolved.** Words, dates and money are formatted by
 * the Server Component above (`page.tsx`) in the reader's locale and the
 * shop's timezone — this component is the browser half and formats nothing.
 */
export type RosterRow = {
  personId: string;
  fullName: string;
  href: string;
  /** The letter this name files under, or null when it starts with none. */
  letter: string | null;
  /** Exceptional only. A clear diver's row carries none — that is the design. */
  badges: RosterBadge[];
  /** The row's one quiet fact: a seat ahead, a visit behind, or provenance. */
  fact: string | null;
};

/**
 * Every value is a plain string — never a function. This is a client
 * component with its own client-side-only state (the search text), so the
 * translated copy is fully resolved server-side and handed down as plain
 * data; no translator ever crosses the Server->Client boundary.
 */
export interface DiverListCopy {
  /**
   * The quick-add button, in both of its states — beside a search that has
   * text in it, and beside an empty one, where the same words open the full
   * add-a-diver form instead. One string, because it is one offer either way.
   */
  addDiverLabel: string;
  viewAllDivers: string;
  viewDivingToday: string;
  viewNeedsAttention: string;
  viewMissingContact: string;
  viewRemoved: string;
  viewsAriaLabel: string;
  /** Replaces the count line while the Removed view is on. */
  removedNote: string;
  /** "312 divers", or "3 matching" while a search is on. Already pluralised. */
  countLabel: string;
  searchDiversLabel: string;
  searchPlaceholder: string;
  noDiversMatchView: string;
  noDiversOnFile: string;
  addOneHere: string;
  emptyShowAll: string;
  emptyImportBody: string;
  emptyImportAction: string;
  /** The group label over the names that begin with no letter at all. */
  letterOther: string;
}

/**
 * **The roster is one ledger** — ADR 20260827-people-not-lists, decision 2.
 *
 * One composition at every width: search, the view chips, and rows grouped by
 * the initial letter they already sort by. The `sm:hidden` card list and the
 * three-column desktop table it duplicated are both gone — the roster used to
 * render every diver twice and call one of them the phone.
 *
 * Three rules the rows hold to, each pinned in `DiverList.test.tsx`:
 *
 * - **A row is a name, and the name is the door.** No avatar, no contact line,
 *   no level column. A staffer scanning a hundred names is looking for one of
 *   them, and everything else on the row was competing with it.
 * - **A badge marks the exceptional state and nothing else** (ADR
 *   20260827-clearwater-surface-language, decision 3): a blocker, a standing
 *   invoice, a possible duplicate. A clear diver's row carries none — the
 *   silence is the design, which is why the test asserts absence as hard as
 *   presence. The retired "pending review" / "to confirm" counts were the
 *   opposite reading: a badge on every row of the one view whose chip already
 *   says why they are all there.
 * - **The letter belongs to the group header, never to the rows.** One shared
 *   fact, stated once, in the app's one group-label spelling (`GroupLabel`).
 *
 * The list still drives the URL as you type — the input debounces into `?q=`
 * and the server answers with the matching page, so the roster scales to
 * thousands of records without shipping them all to the browser. Pages are
 * `?page=` links, so back/forward and sharing keep working.
 */
export function DiverList({
  rows,
  total,
  shopSlug,
  query,
  filter,
  importHref,
  canRestore,
  quickAddAction,
  copy,
  pager,
}: {
  /** This page of the roster, in the query's own order. */
  rows: readonly RosterRow[];
  /** How many divers the current view holds, for the one-match Enter shortcut. */
  total: number;
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
  // page together — and the chip is also what says why every row in that view
  // is there, which is why the rows themselves wear no badge for it.
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
  // **The roster opens ready to be typed into**, the way check-in does
  // (`check-in/CheckInSearch.tsx`): a staffer arrives here holding a name, and
  // searching is the first thing they do. Focused through a ref rather than the
  // `autoFocus` attribute because biome's `noAutofocus` rule forbids that JSX
  // prop outright — every focus-on-mount in this repo goes the same way.
  const searchRef = useRef<HTMLInputElement>(null);
  const quickAddFormRef = useRef<HTMLFormElement>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
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
  }, [query]);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  useEffect(() => () => clearTimeout(debounce.current ?? undefined), []);
  /**
   * One capture-phase listener for every row link in the ledger, rather than an
   * `onClick` threaded through `LedgerRow` — the primitive's door is a stretched
   * `<Link>` with no handler slot, and a click anywhere in the ledger means the
   * staffer is leaving. That is exactly when a keystroke still sitting in the
   * debounce must not land 250ms later and replace the record they just opened
   * with the list they just left (see `cancelPendingSearch`).
   *
   * A native listener on a ref rather than React's `onClickCapture`, because
   * the container is a plain `<div>`: an interaction handler on one is a
   * static-element-interaction the linter is right to ask about, and the honest
   * answer is that this is not an interaction at all — it is a timer being
   * dropped as the page unloads under the reader.
   */
  useEffect(() => {
    const ledger = ledgerRef.current;
    if (!ledger) return;
    const drop = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = null;
    };
    ledger.addEventListener("click", drop, true);
    return () => ledger.removeEventListener("click", drop, true);
  }, []);

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
      // Cleared before the replace so the navigation this triggers is free to
      // sync the input again — the timer is no longer "pending" once it fires.
      debounce.current = null;
      router.replace(hrefFor(value, filter), { scroll: false });
    }, 250);
  };

  /**
   * Enter is the fast path past whatever the debounce hasn't caught up to yet.
   * A pending keystroke (`typed !== query`) gets flushed immediately rather
   * than acted on blind — the visible rows still answer the *previous* query,
   * so a match count read off them now would be stale. Once the URL is
   * current, one match opens straight to that diver's record; no match at all
   * reaches for the same quick-add the button beside the box already offers,
   * so typing a new name and hitting Enter never requires the mouse.
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
    const only = total === 1 ? rows[0] : undefined;
    if (only) {
      router.push(only.href);
      return;
    }
    quickAddFormRef.current?.requestSubmit();
  };

  /** A search box or a view chip is on, so "nothing here" is a filter result. */
  const narrowed = Boolean(query) || filter !== "all";
  /**
   * The views row governs a roster. On day one there is no roster: four chips
   * that all resolve to the same nothing are controls with nothing to control —
   * and they sit above the one thing that helps, the empty card's "Add your
   * first diver". Narrowed-to-nothing is a different state and keeps the row:
   * the chips are how you widen back out.
   */
  const showViews = rows.length > 0 || narrowed;
  const groups = groupByLetter(rows);

  return (
    <section className="mt-8">
      {/* Hidden over a day-one empty roster (see `showViews` above); kept
          whenever a search or chip narrowed the list, so the way back out
          stays on screen. */}
      {showViews ? (
        <FilterChips
          label={copy.viewsAriaLabel}
          className="mb-5"
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
      {/* Phone: the button wraps to its own row under a full-width box and the
          count sits beneath both. Desktop: box and button on the left, the
          count quiet on the right — the artboard's one line. Either way the
          button is on screen from first paint; it used to mount on the first
          keystroke and slide the search box aside to make room, which on a
          phone moved the box under the thumb typing into it (#781). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchField
            ref={searchRef}
            id="diver-search"
            label={copy.searchDiversLabel}
            value={typed}
            onChange={(event) => search(event.target.value)}
            onKeyDown={submitSearch}
            placeholder={copy.searchPlaceholder}
            className="w-full min-w-0 sm:w-80"
          />
          {/* One offer, two doors, and deliberately the same words on both so
              the swap on the first keystroke is invisible. With something
              typed, one tap creates that person and lands on their record.
              With an empty box there is nothing to create from — submitting
              the quick-add would bounce off `?notice=invalid` — so the same
              button opens the full form instead, which is also the roster's
              only add-a-diver door on day one. */}
          {quickAddAction ? (
            typed.trim() ? (
              <form ref={quickAddFormRef} action={quickAddAction} onSubmit={cancelPendingSearch}>
                <input type="hidden" name="query" value={typed.trim()} />
                <SubmitButton
                  pendingLabel={copy.addDiverLabel}
                  className={buttonClass({
                    variant: "primary",
                    className: "whitespace-nowrap",
                  })}
                >
                  {copy.addDiverLabel}
                </SubmitButton>
              </form>
            ) : (
              <Link
                href={`/shop/${shopSlug}/divers/new`}
                // Nothing is pending — the box is empty — but a timer from the
                // text the staffer just cleared could still be, and landing
                // after this tap would put that search back in the URL behind
                // them (same reasoning as the view chips above).
                onClick={cancelPendingSearch}
                className={buttonClass({
                  variant: "primary",
                  className: "whitespace-nowrap max-sm:w-full",
                })}
              >
                {copy.addDiverLabel}
              </Link>
            )
          ) : null}
        </div>
        {/* The Removed view's line says what removal actually means here,
            because the list underneath looks exactly like the roster and
            nothing else on screen would tell a reader these people are off
            every list. It is the shared fact of that whole view, stated once
            where the count would be rather than repeated as a badge down every
            row. */}
        <p className="text-sm text-muted tabular-nums">
          {filter === "removed" ? copy.removedNote : copy.countLabel}
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          className="mt-6"
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
        <div ref={ledgerRef} className="mt-8 flex flex-col gap-7">
          {groups.map((group, index) => {
            const labelId = `roster-letter-${index}`;
            return (
              <LedgerGroup
                // The index is part of the key on purpose: a collation can put
                // the same letter in two runs, and `groupByLetter` renders both
                // rather than reordering the page under the pager.
                key={labelId}
                as="h2"
                id={labelId}
                label={group.letter ?? copy.letterOther}
              >
                <ul className="mt-2" aria-labelledby={labelId}>
                  {group.rows.map((row) => (
                    // Everything sits in the row's own content rather than in
                    // `LedgerRow`'s `trailing` slot, and the row carries no
                    // control at all: `trailing` is `z-10`, deliberately, so
                    // that a real button sits *above* the stretched link — and
                    // a quiet date parked there would be a strip of dead pixels
                    // down the right of every row on a page whose whole
                    // interaction is "tap the row".
                    <LedgerRow key={row.personId} href={row.href} linkLabel={row.fullName}>
                      <div className="min-w-0 flex-1 py-2 sm:flex sm:items-center sm:gap-3">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="break-words font-semibold">{row.fullName}</span>
                          {row.badges.map((badge) => (
                            <Badge
                              key={badge.label}
                              tone={badge.tone}
                              size="sm"
                              className="shrink-0"
                            >
                              {badge.label}
                            </Badge>
                          ))}
                        </div>
                        {row.fact ? (
                          <div className="mt-1 flex min-w-0 shrink-0 items-center gap-2 text-sm text-muted tabular-nums sm:mt-0 sm:max-w-[45%]">
                            <span className="min-w-0 truncate">{row.fact}</span>
                          </div>
                        ) : null}
                      </div>
                    </LedgerRow>
                  ))}
                </ul>
              </LedgerGroup>
            );
          })}
        </div>
      )}
      {pager}
    </section>
  );
}
