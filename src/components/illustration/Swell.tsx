import type { AnimationEventHandler } from "react";

/**
 * The swell — Reef's divider and its band, drawn once (ADR
 * 20260901-diveday-reimagined, decision 1; the system sheet's "one hand, six
 * drawings": *Swell — the divider, the band*).
 *
 * Two lines in the hand every other drawing uses — a 1.7px stroke, round caps
 * and joins, `vector-effect: non-scaling-stroke` so a swell stretched across a
 * station and one inside a 64px course tile are drawn with the same pen. The
 * second line rides under the first at 40%, which is what makes it water
 * rather than a rule.
 *
 * One component rather than a path pasted where it is needed: the station's
 * settling moment and the course card's placeholder each carried their own
 * wave before this, at two stroke weights that did not reference each other,
 * so "the hand" was two hands. A change to the line is now one change.
 *
 * Decorative by contract (`aria-hidden`); ink comes from `currentColor`, so
 * the caller sets the tone — lagoon-deep on a staff surface, the storefront's
 * `--primary` on a card wearing the shop's brand. Never coral: the swell is
 * water, and coral is rationed to the moment it sits beside.
 */
export const SWELL_VIEWBOX = "0 0 260 26";

export const SWELL_PATHS = {
  crest: "M0 14c26-11 52-11 78 0s52 11 78 0 52-11 78 0 22 6 26 4",
  trough: "M0 22c26-11 52-11 78 0s52 11 78 0 52-11 78 0 22 6 26 4",
} as const;

export function Swell({
  className = "",
  onAnimationEnd,
  ...rest
}: {
  className?: string;
  onAnimationEnd?: AnimationEventHandler<SVGSVGElement>;
  [key: `data-${string}`]: string | boolean | undefined;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox={SWELL_VIEWBOX}
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      onAnimationEnd={onAnimationEnd}
      className={className}
      {...rest}
    >
      <path vectorEffect="non-scaling-stroke" d={SWELL_PATHS.crest} />
      <path vectorEffect="non-scaling-stroke" d={SWELL_PATHS.trough} opacity={0.4} />
    </svg>
  );
}
