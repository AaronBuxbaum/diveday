/**
 * Canonical status pill. Every hand-rolled "rounded-full bg-X/10 text-X" span
 * across the staff app was a slightly different copy of this shape — this is
 * the one to reach for instead, so a diver-ready pill and an order-status pill
 * read as the same kind of thing everywhere they appear.
 */

const toneClass = {
  primary: "bg-primary/10 text-primary",
  // text-success/warning on their own tinted fill measured just under AA at
  // badge text sizes (docs/design/forms-and-controls.md) — -strong is the
  // same hue, nudged dark enough to clear 4.5:1.
  success: "bg-success/10 text-success-strong",
  warning: "bg-warning/10 text-warning-strong",
  danger: "bg-danger/10 text-danger",
  neutral: "border border-border bg-surface-sunken text-muted",
} as const;

export type BadgeTone = keyof typeof toneClass;

/**
 * A decorative, `aria-hidden` glyph before the badge's own words — status
 * here is otherwise hue + reading the words, which a colorblind scan can miss
 * before it even gets to the words. Only for the three tones that mean a
 * pass/fail/caution status; `primary`/`neutral` badges are counts and labels,
 * not a status to disambiguate.
 */
const toneGlyph: Partial<Record<BadgeTone, string>> = {
  success: "✓ ",
  warning: "▲ ",
  danger: "✕ ",
};

const sizeClass = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1 text-sm",
} as const;

export type BadgeSize = keyof typeof sizeClass;

export function Badge({
  tone = "neutral",
  size = "md",
  tabularNums = false,
  className = "",
  children,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Set for a numeric value (a count, a ratio) so digits stay aligned. */
  tabularNums?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const glyph = toneGlyph[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${
        glyph ? "gap-1" : ""
      } ${sizeClass[size]} ${toneClass[tone]}${tabularNums ? " tabular-nums" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}
      {children}
    </span>
  );
}
