import type { ReactNode } from "react";

/**
 * The one header bar both shells wear — the staff app's and the shopfront's.
 *
 * ADR 20260827-clearwater-surface-language, decision 10 ("One chrome spec").
 * **This component must not drift.** Before it, the two shells were two bars:
 * the staff one 69px of `bg-surface` at `z-30`, the public one a shorter
 * `bg-surface/95` at `z-40`, and a child component three directories away
 * carrying `sticky top-[68px]` because the staff bar's height was content-
 * driven and could only be measured, never read. One of the two bars painted
 * over its own sticky day headers as a result.
 *
 * So the bar is a fixed height rather than a padded row, and that height is a
 * token (`--chrome-h`, declared in `globals.css`) rather than a number: the
 * bar sets `h-(--chrome-h)` and every surface that pins something beneath it
 * says `top-(--chrome-h)`, so the two can no longer disagree.
 * `src/components/chrome/chrome.test.ts` scans `src/app`, `src/components`,
 * `src/features` and `e2e` and fails on a hand-written distance: a bracketed
 * offset whose measured part is a length rather than a variable
 * (`top-[68px]`, `pt-[68px]`, `scroll-mt-[3.5rem]`), or Tailwind's own scale
 * on a sticky/fixed element (`sticky top-20`, which is how the roll-call panel
 * spent a day pinned 24px below a bar that had become 56px). That guard has
 * its own fixture test, because a detector nobody has run against a positive
 * case is an assertion about a regex.
 *
 * Chrome recedes: the page background at 85% behind a blur, one hairline, no
 * shadow (decision 1 — elevation is earned, and a bar that is always there is
 * not floating). The `supports-[backdrop-filter]` pair is the fallback, not
 * decoration: where the blur cannot run, the bar is solid `bg-background`
 * rather than 85% of it, because a translucent bar with nothing blurring
 * behind it is just content showing through the navigation.
 *
 * **The page's `<h1>` stays in the page.** This bar renders no title and no
 * collapsing large-title behavior — that alternative was considered and
 * deferred in the ADR, because it needs a scroll listener under every page and
 * this app's best property is instant, skeleton-first navigation. It also
 * carries no connectivity indicator: `ConnectivityStatus` stays a page-level
 * `onlyWhenOffline` mount, so the chrome says nothing on the ordinary day.
 */

/**
 * The bar itself, exported so tests can read the one class string rather than
 * a rendered approximation of it.
 *
 * `h-(--chrome-h)` and not `h-14`: 3.5rem is the same 56px, but written this
 * way the bar's height and every sticky offset beneath it are one declaration.
 */
export const CHROME_BAR_CLASS =
  "sticky top-0 z-30 h-(--chrome-h) border-b border-border bg-background backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 print:hidden";

export function ChromeBar({
  leading,
  center,
  trailing,
}: {
  /** The shop's own identity — the staff shell's menu, the shopfront's name. */
  leading: ReactNode;
  /**
   * The destinations that sit beside the identity: the staff tab strip from
   * `lg` up. The shopfront puts its two-tab nav in `trailing` instead, beside
   * the language picker, because that is one cluster on that shell — the nav
   * and the picker are both "which page, which words", and the artboards draw
   * them together at the right edge.
   */
  center?: ReactNode;
  /** Search, language, the reader's own controls — always at the far edge. */
  trailing?: ReactNode;
}) {
  return (
    <header className={CHROME_BAR_CLASS}>
      {/* One row, always — a fixed height cannot wrap, so every slot shrinks
          instead. `min-w-0` on the two content slots is what lets a long shop
          name ellipse rather than push the row wider than the viewport.

          The gaps tighten below `sm` and the horizontal padding does not: the
          padding is what lines the shop's name up with the left edge of the
          page under it, so buying phone pixels there would buy them from the
          one thing the bar is supposed to hold still. */}
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-x-2 px-4 sm:gap-x-3 sm:px-6">
        <div className="flex min-w-0 shrink items-center">{leading}</div>
        {center ? <div className="flex min-w-0 flex-1 items-center">{center}</div> : null}
        {trailing ? (
          <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
            {trailing}
          </div>
        ) : null}
      </div>
    </header>
  );
}
