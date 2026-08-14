import type { ReactNode } from "react";

/**
 * The one header for bearer-token pages — the screens a diver opens from a
 * text message or an email (/waivers, /ready, /recap, /claim): a shop-name
 * eyebrow, the page's title, and whatever muted meta lines the page needs
 * underneath.
 *
 * The idiom (uppercase tracked eyebrow → 3xl title → meta) was hand-duplicated
 * byte-for-byte across those four pages before this component existed; this is
 * the single copy, and all four wear it.
 *
 * The eyebrow is `text-muted`, deliberately: `text-primary` is reserved for
 * things a finger can press, and a shop-name eyebrow is context, not an action.
 * The four pages disagreed about this for a while (the component shipped
 * primary, `/ready` hand-rolled muted); muted is the settled answer, so please
 * do not "fix" it back — and there is no `tone` prop, because one family of
 * pages gets one grammar.
 *
 * Slots, not styling knobs: `eyebrow` takes one line or two (seat-claim stacks
 * a purpose line over the shop's name; `/ready` deliberately passes the shop's
 * name alone), `title` is the `<h1>`, and `children` are the meta lines — the
 * component deliberately does not style what the page puts there, because the
 * pages' meta genuinely differs (a trip line at `font-medium`, a muted
 * description, a share row).
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
      {eyebrows.map((line, index) => (
        // Index keys, deliberately: the list is static per render, and keying
        // by text would collide if a caller ever passed two identical lines
        // (a shop named the same as a page's purpose line).
        // biome-ignore lint/suspicious/noArrayIndexKey: static list, text can repeat
        <p key={index} className="text-sm font-medium tracking-widest text-muted uppercase">
          {line}
        </p>
      ))}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {children}
    </header>
  );
}
