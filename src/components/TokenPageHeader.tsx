import type { ReactNode } from "react";

/**
 * The one header for bearer-token pages — the screens a diver opens from a
 * text message or an email (/waivers, /ready, /recap, /claim): a shop-name
 * eyebrow, the page's title, and whatever muted meta lines the page needs
 * underneath.
 *
 * The idiom (uppercase tracked eyebrow → 3xl title → meta) was hand-duplicated
 * byte-for-byte across those four pages before this component existed; this is
 * the single copy. `/waivers` wears it today — adopting it on the other three
 * is FU-20260813-token-page-header-adoption, deferred only because parallel
 * branches were redesigning those pages at the same time.
 *
 * Slots, not styling knobs: `eyebrow` takes one line or two (readiness and
 * seat-claim stack a purpose line over the shop's name), `title` is the `<h1>`,
 * and `children` are the meta lines — the component deliberately does not style
 * what the page puts there, because the pages' meta genuinely differs (a trip
 * line at `font-medium`, a muted description, a share row).
 */
export function TokenPageHeader({
  eyebrow,
  title,
  children,
}: {
  /** The line(s) above the title — usually the shop's name; a page with a purpose line stacks two. */
  eyebrow: string | readonly string[];
  title: ReactNode;
  /** Meta lines under the `<h1>`; rendered as given. */
  children?: ReactNode;
}) {
  const eyebrows = typeof eyebrow === "string" ? [eyebrow] : eyebrow;
  return (
    <header>
      {eyebrows.map((line) => (
        <p key={line} className="text-sm font-medium tracking-widest text-primary uppercase">
          {line}
        </p>
      ))}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {children}
    </header>
  );
}
