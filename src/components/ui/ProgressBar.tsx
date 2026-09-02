/** One band of a bar: how much of the track it claims, and what colour it is. */
export interface ProgressSegment {
  /** 0–1 of the whole track. Clamped, so a bad count cannot overflow the bar. */
  fraction: number;
  /** A background utility — `bg-primary`, `bg-success/70`. */
  className: string;
  /** Distinguishes the segments across renders so React does not re-key them. */
  key: string;
}

/**
 * **The app's one progress bar.**
 *
 * There were three, and no two behaved alike: the shop home's boarding bar
 * jumped, the manifest's roll-call bar transitioned on Tailwind's default
 * curve, and the waiver's answered-count bar transitioned on
 * `--ease-out-soft`. Same idea — how far through something a person is — on
 * two surfaces a staffer moves between all morning (issue #834).
 *
 * **Every fill is a full-width element scaled with `scaleX`**, never a `width`.
 * That is principle 5's "transform/opacity only" applied: `width` is layout, so
 * the browser reflows every frame of the transition, while a transform is
 * composited and produces identical output. The measured frame cost was
 * already zero — this is the rule the repo wrote for itself, not a performance
 * complaint.
 *
 * Segments are a list rather than a single value because the boarding bar is
 * three stacked bands (boarded, then clear-to-board, then blocked) and that is
 * the reason the other two never reused it.
 *
 * **They are drawn as layers, widest first.** Each band is a full-width sheet
 * scaled to its *cumulative* share and stacked on the ones behind it, so three
 * bands reading 2 / 3 / 1 of six render as a full-width danger sheet, a
 * five-sixths success sheet over it, and a two-sixths primary sheet over that
 * — left to right, exactly as before. Laying them out as flex items with real
 * widths would put the animation back on `width`, which is the thing this
 * exists to avoid; a sheet that only ever scales is composited.
 *
 * **It renders no ARIA of its own.** What a bar means differs per surface: the
 * boarding bar is decorative beside a caption that carries every fact in words
 * (principle 6), and the waiver's is described by a `role="status"` sentence
 * above it. The caller owns that, and this owns the pixels. (The manifest's
 * roll-call bar, once the third caller, became the round `HeadCount` figure —
 * ADR 20260901-diveday-reimagined, slice 13h — which scales its water the same
 * way for the same reason.)
 */
export function ProgressBar({
  segments,
  className = "",
  trackClassName = "bg-surface-sunken",
  ...rest
}: {
  /** Left to right, as a reader sees them. The stacking order is worked out here. */
  segments: ProgressSegment[];
  /** The track's height and any spacing — `h-2`, `mt-1.5 h-1.5`. */
  className?: string;
  trackClassName?: string;
  /**
   * Whatever the surface needs the track itself to say — `aria-hidden` on the
   * decorative boarding bar, or a `role="progressbar"` with its values. The
   * meaning is the caller's; the pixels are this component's.
   */
} & React.HTMLAttributes<HTMLDivElement>) {
  // Rounded to four places, which is a tenth of a pixel on a 1000px track and
  // therefore invisible — but `2/6 + 3/6 + 1/6` is `0.9999999999999999`, and a
  // bar that ends a sub-pixel short of its own track writes that number into
  // the DOM. Rounding keeps the rendered HTML stable for the visual baselines
  // as well.
  const clamp = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 1e4) / 1e4;
  let running = 0;
  const layers = segments.map((segment) => {
    running = clamp(running + segment.fraction);
    return { ...segment, cumulative: running };
  });
  return (
    <div
      {...rest}
      className={`relative overflow-hidden rounded-full ${trackClassName} ${className}`.trim()}
    >
      {/* Reversed: the widest sheet is furthest back, so each narrower one
          paints over its left-hand share of the sheet beneath. */}
      {[...layers]
        .reverse()
        .map((layer) =>
          layer.cumulative <= 0 ? null : (
            <div
              key={layer.key}
              style={{ transform: `scaleX(${layer.cumulative})` }}
              className={`absolute inset-0 origin-left transition-transform ${layer.className}`}
            />
          ),
        )}
    </div>
  );
}
