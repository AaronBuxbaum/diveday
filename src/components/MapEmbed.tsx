import type { ReactNode } from "react";

/**
 * A Google Maps embed whose route overlay can keep the provider's attribution
 * visible without changing the map frame the route was drawn against.
 *
 * The classic `output=embed` map draws its own furniture at the edges — a
 * "View larger map" chip top-left, pan/zoom controls in a corner, and a bottom
 * bar carrying "Keyboard shortcuts", "Map data ©…", "Terms" and "Report a map
 * error". The route surfaces keep the corner controls out of the drawing area,
 * but expose the provider's bottom attribution strip below it.
 *
 * The chrome cannot be turned off by a URL parameter, so it is put *outside the
 * window* instead: the iframe remains inflated symmetrically around the
 * original drawing window. The outer frame grows by the same 64px that used to
 * be hidden below it, so the iframe keeps the old dimensions and the old route
 * pixels remain unchanged. Only the provider's bottom strip becomes visible in
 * that added band. Overlays are positioned against the original-height inner
 * window, not the attribution band, for the same reason.
 */
export function MapEmbed({
  title,
  src,
  className = "",
  interactive = false,
  showAttribution = false,
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
  /** Expose the provider's bottom attribution strip below the route window. */
  showAttribution?: boolean;
  /** Overlays drawn over the map — the route SVG, a click surface. */
  children?: ReactNode;
}) {
  const iframeHeightClass = showAttribution ? "h-[calc(100%+4rem)]" : "h-[calc(100%+8rem)]";

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
        className={`absolute -top-16 -left-16 ${iframeHeightClass} w-[calc(100%+8rem)] border-0 ${
          interactive ? "" : "pointer-events-none"
        }`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {showAttribution ? (
        <div className="absolute inset-x-0 top-0 h-[calc(100%-4rem)]">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
