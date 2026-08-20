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
 * - **Overflow scrolls, never wraps.** Labels are `whitespace-nowrap` and the
 *   track is a `snap-x` scroller, so a narrow phone slides the row instead of
 *   stacking it.
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
  /** The default 44px dock-test target. */
  md: "min-h-11 px-3 text-sm",
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
  } snap-x gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-sunken p-1 print:hidden ${className}`.trim();
  return (
    <nav aria-label={ariaLabel} className={track}>
      {items.map((item) => {
        const active = item.key === currentKey;
        const cls = `inline-flex ${
          fill ? "flex-1" : "shrink-0"
        } snap-start items-center justify-center rounded-xl font-semibold whitespace-nowrap transition-colors duration-200 ${sizes[size]} ${
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
