import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The pager's own words, already in the reader's language: the landmark's
 * name, the two links, and the position line. They come from whichever bundle
 * the surface speaks — `staffPagerWords` below for every staff list, the
 * diver's bundle on the public reviews archive — so the one pager serves both
 * without either vocabulary reaching into the other.
 */
export type PagerWords = {
  /** The navigation landmark's name ("Pages"). */
  label: string;
  previous: string;
  next: string;
  /** "Page 3 of 7". */
  position: (page: number, pageCount: number) => string;
};

/** The staff lists' words: `shared.pager.*`, one set for every paged staff list. */
export function staffPagerWords(t: StaffTranslator): PagerWords {
  return {
    label: t("shared.pager.label"),
    previous: t("shared.pager.previous"),
    next: t("shared.pager.next"),
    position: (page, pageCount) => t("shared.pager.position", { page, pageCount }),
  };
}

/**
 * The one pager every paged list wears.
 *
 * Four grammars used to coexist for one concept: numbered prev/next with a
 * position line (Orders, the by-departure view), forward-only "Show more" with
 * nothing but "Back to top" behind it (Divers, Reports, Reviews — a staffer on
 * page 3 could not go back one page), a cursor stack with "Show earlier" (the
 * schedule board), and "go look at the board" (the add-booking picker). Staff
 * learned four ways to move through one concept.
 *
 * This is the honest shape: both directions work, and it says where you are.
 * Everything except the board adopts it — the board pages a *stream* of
 * upcoming departures by keyset and has no page count to state, and its
 * "Show earlier" wording is load-bearing there (see `schedule/board/page.tsx`).
 * The public reviews archive wears it too, in the diver's words: a hand-copied
 * pager there kept the empty stand-in this one lost.
 *
 * Renders nothing when there is only one page: a shop with one screenful of
 * invoices should never be told it is on "page 1 of 1", so callers need no
 * `pageCount > 1` guard of their own.
 *
 * A Server Component, deliberately — staff copy never crosses to the client
 * (`src/i18n/staff-messages.ts`). A Client Component that needs a pager takes
 * the rendered element as a prop; see the diver roster's `pager`.
 */
export function Pager({
  page,
  pageCount,
  href,
  words,
  total,
  className,
}: {
  /** The page being shown, 1-based and already clamped by the query. */
  page: number;
  pageCount: number;
  /** This surface's URL for a given page, with its filters kept. */
  href: (page: number) => string;
  words: PagerWords;
  /**
   * What was counted, already translated and pluralised by the surface that
   * owns the noun ("323 orders", "26 departures"). The pager's own words are
   * shared; the noun stays with the list, because a bare noun interpolated
   * into a shared sentence does not survive translation.
   */
  total?: string;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const position = words.position(page, pageCount);
  // **Neither arrow is prefetched.** A page turn differs from the URL you are
  // already on only in its search params, and the App Shell a `<Link>` pulls
  // "does not include URL data that varies by destination, such as
  // `searchParams`" — so the router can never commit off it, and every page
  // wearing it renders per request (the staff lists are authenticated, the
  // public archive calls `connection()`), so a prefetch is a whole extra
  // server render of a page nobody asked for. Measured on the
  // diver roster: click-to-URL is the same with it (199-264ms) and without
  // (207-264ms), because the navigation blocks on the server either way.
  //
  // It is not free, though. With the prefetch in flight, the click attaches to
  // *that* request rather than issuing its own — Chromium reports it
  // `net::ERR_ABORTED` on every run — so a page turn that loses the race
  // against the prefetch scheduler has nothing left to wait on and the URL
  // never moves at all. That is the shape `divers.spec.ts`'s pager test failed
  // in on CI (the URL still read `/shop/blue-mantis/divers` when the assertion
  // gave up), and the shape it was reproduced in locally, where it sat for a
  // full 60 seconds rather than merely being slow.
  //
  // **The readout is centred at every width, and nothing stands in for a
  // missing link.** This was a `justify-between` row with an empty `<span>`
  // where page 1's Previous goes. A spread row centres its middle only while
  // both ends match, so the pixel probe measured "Page 1 of 3 · 47
  // departures" 28px left of centre beside a 57px Next, and the empty span
  // still took the row's 12px gap.
  //
  // From `sm` up it is three columns, the outer two equal, with each link
  // pinned to its own column's outer edge. That shape alone does not hold on
  // a phone: `1fr` is `minmax(auto, 1fr)`, the `auto` readout column takes its
  // whole text width first, and an outer column cannot shrink below the link
  // inside it, so once half the leftover is narrower than Previous the outer
  // columns come out unequal ("Page 1 of 5 · 83 reviews you have ruled on"
  // sat 25px off centre at 390 and 28px at 360). Below `sm` the readout has a
  // row of its own across both columns and the links share the row beneath,
  // which centres it exactly for one more row of height.
  return (
    <nav
      aria-label={words.label}
      className={`grid grid-cols-2 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]${className ? ` ${className}` : ""}`}
    >
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          scroll={false}
          prefetch={false}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "col-start-1 row-start-2 justify-self-start sm:row-start-1",
          })}
        >
          {words.previous}
        </Link>
      ) : null}
      <p className="col-span-2 row-start-1 text-center text-sm text-muted sm:col-span-1 sm:col-start-2">
        {total ? `${position} · ${total}` : position}
      </p>
      {page < pageCount ? (
        <Link
          href={href(page + 1)}
          scroll={false}
          prefetch={false}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "col-start-2 row-start-2 justify-self-end sm:col-start-3 sm:row-start-1",
          })}
        >
          {words.next}
        </Link>
      ) : null}
    </nav>
  );
}
