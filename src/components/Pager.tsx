import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The one pager every paged staff list wears.
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
  t,
  total,
  className,
}: {
  /** The page being shown, 1-based and already clamped by the query. */
  page: number;
  pageCount: number;
  /** This surface's URL for a given page, with its filters kept. */
  href: (page: number) => string;
  t: StaffTranslator;
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
  const position = t("shared.pager.position", { page, pageCount });
  return (
    <nav
      aria-label={t("shared.pager.label")}
      className={`flex items-center justify-between gap-3${className ? ` ${className}` : ""}`}
    >
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
          {t("shared.pager.previous")}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted">{total ? `${position} · ${total}` : position}</p>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
          {t("shared.pager.next")}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
