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
 * Shared offset pager for staff lists and public reviews. The schedule board
 * keeps its keyset pager because it streams upcoming departures without a
 * page count.
 *
 * It omits itself for a single-page result and owns its spacing, so callers
 * need neither guard nor margin. It stays a Server Component to keep staff
 * localization server-side; client callers accept the rendered element.
 */
export function Pager({
  page,
  pageCount,
  href,
  words,
  total,
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
}) {
  if (pageCount <= 1) return null;
  const position = words.position(page, pageCount);
  // Search params are not included in App Shell prefetch, so the speculative
  // render cannot serve a page turn. Keep both links unprefetched to avoid that
  // extra server work and the observed prefetch/click abort race.
  return (
    <nav
      aria-label={words.label}
      className="mt-6 grid grid-cols-2 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]"
    >
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          scroll={false}
          prefetch={false}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "col-start-1 row-start-2 justify-self-start sm:row-start-1 print:hidden",
          })}
        >
          {words.previous}
        </Link>
      ) : null}
      {/* Separate phone row and equal outer columns keep long totals centered
          without placeholder links at the first and last page. */}
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
            className:
              "col-start-2 row-start-2 justify-self-end sm:col-start-3 sm:row-start-1 print:hidden",
          })}
        >
          {words.next}
        </Link>
      ) : null}
    </nav>
  );
}
