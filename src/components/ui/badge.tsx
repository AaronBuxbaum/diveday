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
 * A decorative, `aria-hidden` mark before the badge's own words — status here
 * is otherwise hue + reading the words, which a colorblind scan can miss
 * before it even gets to the words. Only for the three tones that mean a
 * pass/fail/caution status; `primary`/`neutral` badges are counts and labels,
 * not a status to disambiguate.
 *
 * Emoji, not the dingbats (`✓ ▲ ✕`) this shipped with. Those are *text*
 * codepoints: they take the surrounding font and colour, so at badge sizes
 * they render as thin monochrome marks that read as a font falling back
 * rather than as a status — the danger one, sitting on the Today tab's blocked
 * count, was reported as a stray glyph in the copy. An emoji carries its own
 * two-colour artwork at any size and cannot be mistaken for broken text.
 * No trailing space: the badge adds `gap-1` when a mark is present.
 */
const toneGlyph: Partial<Record<BadgeTone, string>> = {
  success: "✅",
  warning: "⚠️",
  danger: "❌",
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
  toneMark = true,
  className = "",
  children,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Set for a numeric value (a count, a ratio) so digits stay aligned. */
  tabularNums?: boolean;
  /**
   * Whether a pass/fail/caution tone also shows its mark. Default on — the
   * mark is what carries the status to a colourblind scan. Turn it off for a
   * badge that is a **count wearing a tone**, not a status: the rule above is
   * that `primary`/`neutral` count badges get no mark, and a `danger`-toned
   * count is the same kind of thing. The nav's blocked-diver count is the one
   * in the tree — a header tab reading "Today ❌ 19" spends a third of a phone
   * header on a mark that disambiguates nothing the number and the red pill
   * have not already said.
   */
  toneMark?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const glyph = toneMark ? toneGlyph[tone] : undefined;
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
