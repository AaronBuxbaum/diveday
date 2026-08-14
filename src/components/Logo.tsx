import Link from "next/link";

/** The side of `LogoMark`'s square viewBox — the unit `LOGO_MARK_CIRCLES` is in. */
export const LOGO_MARK_VIEWBOX = 24;

/**
 * The mark's geometry — the one place the bubble-trail is drawn.
 *
 * Kept as data rather than as three `<circle>` elements because the mark has a
 * second renderer: the link-preview cards go through satori, which has no
 * `<svg>`, so `src/app/_og/card.tsx` derives absolutely-positioned boxes from
 * this same list. It used to be hand-copied there — four times — and a rescale
 * from a 40px box to a 48px one landed on one card and left three with the old
 * coordinates, each individually plausible (FU-20260812). Coordinates only:
 * `tone` is a code the renderer colors, because the two renderers have no
 * palette in common (CSS custom properties on one side, hex literals on the
 * other, since a bitmap has no stylesheet).
 */
export const LOGO_MARK_CIRCLES = [
  { cx: 7, cy: 17, r: 5, tone: "current", opacity: 1 },
  { cx: 15.5, cy: 9, r: 3.4, tone: "current", opacity: 0.75 },
  { cx: 19.5, cy: 4.5, r: 2, tone: "accent", opacity: 1 },
] as const satisfies readonly {
  cx: number;
  cy: number;
  r: number;
  tone: "current" | "accent";
  opacity: number;
}[];

/**
 * The bubble-trail mark: three ascending bubbles reading calm, controlled
 * ascent. The top bubble is always the rationed coral accent (ADR-0004); the
 * other two inherit `currentColor` so the mark reads correctly on any
 * surface — teal on sand, or white-on-primary inside a badge.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${LOGO_MARK_VIEWBOX} ${LOGO_MARK_VIEWBOX}`}
      className={className}
      aria-hidden="true"
    >
      {LOGO_MARK_CIRCLES.map((circle) => (
        <circle
          key={`${circle.cx},${circle.cy}`}
          cx={circle.cx}
          cy={circle.cy}
          r={circle.r}
          fill={circle.tone === "accent" ? "var(--accent)" : "currentColor"}
          opacity={circle.opacity === 1 ? undefined : circle.opacity}
        />
      ))}
    </svg>
  );
}

/**
 * The brand lockup — the mark, "DiveDay", and its full stop — in the two
 * placements the product uses. It was hand-drawn in three files (the marketing
 * header, the marketing footer, and the entry doors' wordmark) until
 * FU-20260813; a brand tweak applied to one silently missed the others.
 *
 *  - `lockup` (default) stands on its own: a 24px mark beside the name at
 *    `text-base` semibold, with the full stop in the rationed primary. This is
 *    the header's home link and the identity line above a token page's title.
 *  - `inline` sets the name inside a running muted line — the footer's
 *    "DiveDay. <tagline>". The mark drops to 16px and the *whole* name,
 *    including its stop, is bolded to `text-foreground`, so the stop reads as
 *    the punctuation it is in that sentence rather than as a coral speck.
 *
 * Pass `href` to render the lockup as a link (the header's way home);
 * otherwise it is a `<p>`. `children` follows the name inside the same text
 * flow, so a trailing tagline wraps with it instead of becoming its own flex
 * item.
 */
export function Wordmark({
  variant = "lockup",
  href,
  className = "",
  children,
}: {
  variant?: "lockup" | "inline";
  /** Render as a link to this href instead of a `<p>`. */
  href?: string;
  /** Extra classes on the root (alignment, spacing, color). */
  className?: string;
  /** Trailing content in the same text flow as the name (the footer tagline). */
  children?: React.ReactNode;
}) {
  const inline = variant === "inline";
  const rootClass = [
    inline
      ? "flex items-center gap-2"
      : "flex items-center gap-2 text-base font-semibold tracking-tight",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <LogoMark className={inline ? "size-4 shrink-0 text-primary" : "size-6 text-primary"} />
      {/* i18n-exempt: brand name */}
      <span>
        {inline ? (
          // i18n-exempt: brand name
          <span className="font-semibold text-foreground">DiveDay.</span>
        ) : (
          <>
            DiveDay<span className="text-primary">.</span>
          </>
        )}
        {children}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={rootClass}>
      {content}
    </Link>
  ) : (
    <p className={rootClass}>{content}</p>
  );
}
