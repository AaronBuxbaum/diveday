import type { ReactNode } from "react";

/**
 * The one header bar both shells wear — the staff app's and the shopfront's.
 * Its phone behavior is part of ADR 20260830-responsive-surface-consistency.
 *
 * ADR 20260827-clearwater-surface-language, decision 10 ("One chrome spec").
 * **This component must not drift.** Before it, the two shells were two bars:
 * the staff one 69px of `bg-surface` at `z-30`, the public one a shorter
 * `bg-surface/95` at `z-40`, and a child component three directories away
 * carrying `sticky top-[68px]` because the staff bar's height was content-
 * driven and could only be measured, never read. One of the two bars painted
 * over its own sticky day headers as a result.
 *
 * The staff bar keeps that fixed height. The public bar can grow when its
 * existing controls wrap; its observer publishes the actual height to the
 * same `--chrome-h` token every sticky surface reads. Its independent baseline
 * minimum never reads that output, so the header can shrink again too.
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
 * **The page's `<h1>` stays in the page** — but below `lg` the bar now carries
 * a *folded label*, which is not the same thing. ADR
 * 20260827-clearwater-surface-language deferred the collapsing large title and
 * named the condition for revisiting it: "a new fact (a CSS-only mechanism),
 * not a fresh opinion". `animation-timeline: scroll()` is that fact, and ADR
 * 20260907-nothing-from-nowhere decision 5 spends it — over the first 120px of
 * scroll the shop's name gives way and the page's own title takes its place at
 * 17/600, with the mark staying and still opening the shop menu. No scroll
 * listener, so the instant, skeleton-first navigation this bar was protecting
 * costs nothing.
 *
 * The bar itself still renders neither: `ShopNav` puts an empty, `aria-hidden`
 * `[data-chrome-title-slot]` in the leading slot and the page's own
 * `ShopPageHeader` fills it through a portal (`FoldedPageTitle`). The heading
 * stays one element in the page; the label is a decorative copy. And the
 * storefront does not fold — `PublicShopChrome` composes this same bar and
 * renders no slot, so the portal has no target there.
 *
 * It also carries no connectivity indicator: `ConnectivityStatus` stays a
 * page-level `onlyWhenOffline` mount, so the chrome says nothing on the
 * ordinary day.
 */

/**
 * The bar itself, exported so tests can read the one class string rather than
 * a rendered approximation of it.
 *
 * `h-(--chrome-h)` and not `h-14`: 3.5rem is the same 56px, but written this
 * way the bar's height and every sticky offset beneath it are one declaration.
 */
const CHROME_BAR_SURFACE_CLASS =
  "sticky top-0 z-30 border-b border-border bg-background backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 print:hidden";
export const CHROME_BAR_CLASS = `${CHROME_BAR_SURFACE_CLASS} h-(--chrome-h)`;

export function ChromeBar({
  leading,
  trailing,
  staffChrome = false,
  stackedOnPhone = false,
  naturalHeight = false,
}: {
  /** The shop's own identity — the staff shell's menu, the shopfront's name. */
  leading: ReactNode;
  /** Search, language, the reader's own controls — always at the far edge. */
  trailing?: ReactNode;
  /** Marks the staff shell for the full-viewport live manifest exception. */
  staffChrome?: boolean;
  /**
   * Below `sm`, two rows rather than one: the leading slot on its own line
   * above the trailing cluster (issue #2303, the shopfront's name above its
   * tabs). `globals.css` reads the marker and sets the two-row baseline.
   * Natural-height public chrome can grow above it, with its observer keeping
   * every sticky offset in step.
   */
  stackedOnPhone?: boolean;
  /** Public navigation can wrap; its observer publishes the actual sticky clearance. Staff stay fixed. */
  naturalHeight?: boolean;
}) {
  return (
    // `data-chrome-bar` is what `globals.css` asks the document for before it
    // insets the scrollport by this bar's height — the marker, rather than the
    // class, because the class is a look and this is a fact about the page.
    <header
      className={
        naturalHeight
          ? `${CHROME_BAR_SURFACE_CLASS} flex min-h-(--chrome-base-h)`
          : CHROME_BAR_CLASS
      }
      data-chrome-bar=""
      data-staff-chrome={staffChrome || undefined}
      data-chrome-stacked={stackedOnPhone || undefined}
      data-chrome-natural={naturalHeight || undefined}
    >
      {/* The fixed staff row shrinks its slots; public chrome also lets them
          wrap when the viewport or enlarged text needs more room. `min-w-0`
          keeps a long shop name from pushing the row beyond the viewport.

          The gaps tighten below `sm` and the horizontal padding does not: the
          padding is what lines the shop's name up with the left edge of the
          page under it, so buying phone pixels there would buy them from the
          one thing the bar is supposed to hold still. */}
      {/* The staff bar spans the window, because the sidebar under it does:
          the shop's name sits over the nav it names (ADR 20261001-logbook).
          The shopfront's bar keeps the page's own measure. */}
      <div
        className={`mx-auto flex ${naturalHeight ? "flex-wrap max-sm:flex-nowrap" : "h-full"} w-full items-center gap-x-2 px-4 sm:gap-x-3 sm:px-6 ${staffChrome ? "" : "max-w-6xl"} ${stackedOnPhone ? "max-sm:flex-col max-sm:items-stretch max-sm:justify-center max-sm:gap-0" : ""}`}
      >
        <div className="flex min-w-0 shrink items-center">{leading}</div>
        {trailing ? (
          <div
            className={`ms-auto flex ${naturalHeight ? "min-w-0 max-w-full shrink flex-wrap" : "shrink-0"} items-center gap-1.5 sm:gap-2 lg:gap-3 ${stackedOnPhone ? "max-sm:ms-0 max-sm:justify-between" : ""}`}
          >
            {trailing}
          </div>
        ) : null}
      </div>
    </header>
  );
}
