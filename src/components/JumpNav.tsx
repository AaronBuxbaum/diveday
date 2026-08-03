import { buttonClass } from "@/components/ui/button";

/**
 * The one way down a very long single page.
 *
 * Two surfaces have the same problem — the diver record (eleven stacked
 * sections, ~6,400px on a phone) and Settings (~7,000px, eleven forms) — and
 * they solved it twice, with two unrelated grammars. The diver record wore
 * `TripSubNav`'s chrome: a sunken `rounded-2xl` bar of equal-width pills. That
 * bar is a *tab* bar everywhere else in `/shop/**`, where exactly one pill is
 * the page you are on; a jump row can never mark anything current, because
 * every entry is on the screen you are already looking at. Identical-looking
 * controls that mean different things is the drift this component ends.
 *
 * So the shared grammar is Settings': a row of link-buttons under a hairline
 * rule. It reads as "places on this page", promises no active state, and can
 * never be mistaken for the tab bars (`TripSubNav`, `WaiversSubNav`), which
 * keep the sunken-bar look and keep meaning "you are here".
 *
 * **Anchors, not routes.** Every entry is a `#id` on the same document, which
 * the browser handles itself: no re-render, no refetch, works before
 * JavaScript arrives, and — on Settings — it cannot disturb
 * `PreserveFormScroll`'s save-on-submit / restore-on-return handshake the way
 * a router navigation or a scroll-scripted button would. That is also why this
 * is a Server Component with no state.
 *
 * Labels arrive resolved: staff copy is server-side only, so each call site
 * translates its own section list and passes words.
 */
export function JumpNav({
  ariaLabel,
  items,
  className = "",
}: {
  ariaLabel: string;
  /** Destinations in page order: the `#id` to jump to and its resolved label. */
  items: readonly { id: string; label: string }[];
  /** Top margin only — the row owns its own rule, padding, and bottom spacing. */
  className?: string;
}) {
  return (
    // The rule sits on the wrapper at content width; the row inside is pulled
    // left by its own first link's padding, so the first label lines up with
    // the page title above rather than sitting 12px inside it. The padding
    // itself stays — with `min-h-11` it is what makes each label a real touch
    // target on a phone. Never on paper: a printed manifest or diver record
    // has no "jump".
    <div className={`mb-8 border-b border-border pb-2 print:hidden ${className}`}>
      <nav aria-label={ariaLabel} className="-ml-3 flex flex-wrap items-center gap-x-1">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={buttonClass({ variant: "link", size: "sm" })}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
