import Link from "next/link";

/**
 * The bubble-trail mark: three ascending bubbles reading calm, controlled
 * ascent. The top bubble is always the rationed coral accent (ADR-0004); the
 * other two inherit `currentColor` so the mark reads correctly on any
 * surface — teal on sand, or white-on-primary inside a badge.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="7" cy="17" r="5" fill="currentColor" />
      <circle cx="15.5" cy="9" r="3.4" fill="currentColor" opacity="0.75" />
      <circle cx="19.5" cy="4.5" r="2" fill="var(--accent)" />
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
