import type { ReactNode } from "react";

/**
 * A Google Maps embed with the provider's own chrome out of frame.
 *
 * The classic `output=embed` map draws its own furniture at the edges — a
 * "View larger map" chip top-left, pan/zoom controls in a corner, and a bottom
 * bar carrying "Keyboard shortcuts", "Map data ©…", "Terms" and "Report a map
 * error". On a route briefing none of it is reachable (the frame is
 * deliberately not interactive — see `DiveSiteMap`) so it is pure noise sitting
 * on top of the reef the shop drew a line across.
 *
 * The chrome cannot be turned off by a URL parameter, so it is put *outside the
 * window* instead: the iframe is inflated symmetrically past every edge of an
 * `overflow-hidden` box. Symmetric matters — the embed centres on its own
 * query at its own zoom, so growing it equally on all four sides moves neither
 * the centre nor the scale. The pixels visible inside the box are exactly the
 * pixels that were visible before, which is what lets a route drawn in frame
 * percentages keep landing on the same water (src/lib/dive-site-route.ts).
 * Overlays are `children`, positioned against the box rather than the iframe,
 * for the same reason.
 */
export function MapEmbed({
  title,
  src,
  className = "",
  interactive = false,
  children,
}: {
  title: string;
  src: string;
  /** Sizing and shape for the visible window — the iframe fills it and then some. */
  className?: string;
  /**
   * Whether the frame itself takes pointer events. Both callers today say no:
   * a panned map is a route drawn against a frame the briefing cannot
   * reproduce. `tabIndex={-1}` follows, since a frame nobody can interact with
   * should not be a stop in the tab order either.
   */
  interactive?: boolean;
  /** Overlays drawn over the map — the route SVG, a click surface. */
  children?: ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* The size is declared, not inferred from opposing insets. An `<iframe>`
          is a *replaced* element, so an `auto` width resolves to its intrinsic
          300×150 and the box is then over-constrained — CSS drops `right` and
          `bottom` on the floor. `-inset-16` alone therefore didn't inflate this
          frame at all; it just shifted the whole map 64px up and left, which is
          the one outcome this must never produce, because the route SVG over it
          is in frame percentages and would have been drawing on the wrong
          water. `calc(100% + 8rem)` resolves against the containing block —
          this box — so the growth stays symmetric and the centre stays put. */}
      <iframe
        title={title}
        src={src}
        tabIndex={interactive ? undefined : -1}
        className={`absolute -top-16 -left-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)] border-0 ${
          interactive ? "" : "pointer-events-none"
        }`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {children}
    </div>
  );
}
