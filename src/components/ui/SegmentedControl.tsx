import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one segmented control: a sunken track with a raised pill on the current
 * choice, for a small set of sibling destinations that are real URLs.
 *
 * Four surfaces used to hand-roll this grammar — the trip tab bar, the waiver
 * tabs, the manifest's checkpoint row, and the Today queue's view switch — and
 * they had already drifted (a fourth `rounded-full` variant, three subtly
 * different class strings). Like `buttonClass()` and `Pager`, the cure is one
 * component: if a segmented control looks wrong, fix it here, never at a call
 * site.
 *
 * The mechanics it guarantees, so no caller has to remember them:
 *
 * - **Links, not client state.** Every option is a real `<Link>` to a real
 *   URL, so it opens in a new tab, bookmarks, and works before JavaScript.
 *   The wrapper is a `<nav>` named by `ariaLabel`.
 * - **Dock-test targets.** `min-h-11` (44px) by default; `size="boat"` raises
 *   the floor to `min-h-14` with 16px labels for surfaces worked at the rail
 *   with wet hands (the manifest's checkpoint row). Labels are centered in
 *   the target structurally (`inline-flex items-center justify-center`).
 * - **No layout shift on selection.** Both states share one font size and one
 *   weight (`font-semibold`); selection is carried by the raised pill —
 *   fill, ink, and shadow plus `aria-current` — never by a weight change that
 *   would reflow the row, and never by color alone.
 * - **Overflow wraps, never scrolls.** Labels stay `whitespace-nowrap`, and a
 *   row too wide for its container stacks onto a second line with each row's
 *   options sharing the width, rather than sliding sideways.
 *
 *   It scrolled until 2026-08-22, and that was measured wrong rather than
 *   decided wrong. At 390px the departure's four tabs came to `scrollWidth 343`
 *   in a `clientWidth 340` — three pixels, which turns a strip that visually
 *   fits into one that clips "Prep" by a hair, drags sideways and springs back,
 *   and jiggles under a thumb that meant to scroll the page. On the surface a
 *   crew member uses to get from the roster to the roll call, on a boat
 *   (issue #811).
 *
 *   **In Spanish the same strip is 436 against 340.** Ninety-six pixels, so no
 *   amount of gap or padding closes it and a scroller was always going to hide
 *   a whole tab from every Spanish-speaking shop. The checkpoint row below is
 *   `size="boat"` with longer labels still. A wrapped row asks for no gesture
 *   and hides nothing, which is what the dock test wants; `e2e/` asserts no
 *   control scrolls at 390px in either locale, because a rendered-pixel diff
 *   cannot tell a clipped strip from a scrollable one.
 * - **Never on paper.** A way to switch surfaces means nothing printed, so
 *   the track is `print:hidden` unconditionally.
 *
 * The current item renders **inert** (a `<span>` with `aria-current`) by
 * default — a tab bar's "you are here" is not a destination. A control whose
 * options are views of the *same* page (`?view=`, `?checkpoint=`) passes
 * `currentIsLink` so the current choice stays a harmless, clickable link, and
 * usually `scroll={false}` so switching views holds the reader's place.
 *
 * Labels arrive resolved: staff copy is server-side only, so each call site
 * translates its own options and passes words. This is a Server Component
 * (no hooks); a Client Component call site (the pathname-reading tab bars)
 * may import it freely.
 */
export type SegmentedControlItem = {
  /** Stable identity, compared against `currentKey`. */
  key: string;
  /** Resolved copy — words come from a message bundle at the call site. */
  label: ReactNode;
  href: string;
};

const sizes = {
  /**
   * The default 44px dock-test target.
   *
   * `px-2.5` rather than `px-3`, which is worth the half-step: the departure's
   * four tabs came to 343px in a 340px container at the narrowest viewport we
   * design for, and 2px off each side of each tab is 16px — enough that English
   * stays on one row instead of wrapping for the sake of three pixels. The
   * target's height is untouched, and its width is set by the label anyway
   * (issue #811).
   */
  md: "min-h-11 px-2.5 text-sm",
  /** Boat surfaces: 56px targets, 16px labels, for wet hands and glare. */
  boat: "min-h-14 px-5 text-base",
} as const;

export type SegmentedControlSize = keyof typeof sizes;

export function SegmentedControl({
  ariaLabel,
  items,
  currentKey,
  size = "md",
  fill = false,
  currentIsLink = false,
  ariaCurrentValue = "page",
  scroll,
  className = "",
}: {
  ariaLabel: string;
  items: readonly SegmentedControlItem[];
  /** The current item's key, or null when no option is current (nothing is marked). */
  currentKey: string | null;
  size?: SegmentedControlSize;
  /** Equal-width options spanning the container, vs. a content-width track. */
  fill?: boolean;
  /**
   * Keep the current choice a clickable link instead of an inert span — for
   * controls whose options are views of the same page rather than routes.
   */
  currentIsLink?: boolean;
  /** `"page"` for tabs between routes; `"true"` for a view choice within one. */
  ariaCurrentValue?: "page" | "true";
  /** Passed to `<Link>`; `false` holds scroll position across a view switch. */
  scroll?: boolean;
  className?: string;
}) {
  // Block-level `flex` in both shapes, never `inline-flex`: an inline-level
  // box opts out of margin collapsing, so a track with `mt-*` below a header
  // with `mb-*` would stack the two margins instead of taking the larger —
  // +28px of phantom space the old hand-rolled navs (all block-level) never
  // had. Content width comes from `w-fit`, not from being inline.
  const track = `flex ${
    fill ? "" : "w-fit max-w-full"
  } flex-wrap gap-1 rounded-inset border border-border bg-surface-sunken p-1 print:hidden ${className}`.trim();
  return (
    <nav aria-label={ariaLabel} className={track}>
      {items.map((item) => {
        const active = item.key === currentKey;
        // `grow` on the content-width variant too: it does nothing while the
        // row fits (a `w-fit` track is exactly its content), and once the row
        // wraps it is what makes each line share its width instead of sitting
        // ragged — four tabs become a 2x2 block on a phone.
        const cls = `inline-flex ${
          fill ? "flex-1" : "grow"
        } items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors ${sizes[size]} ${
          active
            ? "bg-surface text-primary shadow-sm"
            : "text-muted hover:bg-surface hover:text-foreground"
        }`;
        if (active && !currentIsLink) {
          return (
            <span key={item.key} aria-current={ariaCurrentValue} className={cls}>
              {item.label}
            </span>
          );
        }
        return (
          <Link
            key={item.key}
            href={item.href}
            scroll={scroll}
            aria-current={active ? ariaCurrentValue : undefined}
            className={cls}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
