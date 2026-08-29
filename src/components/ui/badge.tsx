import { toneGlyph } from "./tone";

/**
 * Canonical status pill. Every hand-rolled "rounded-full bg-X/10 text-X" span
 * across the staff app was a slightly different copy of this shape — this is
 * the one to reach for instead, so a diver-ready pill and an order-status pill
 * read as the same kind of thing everywhere they appear.
 */

const toneClass = {
  primary: "bg-primary-tint text-primary",
  // Two decisions, and the second is what makes the first hold.
  //
  // `-strong`, not the raw hue: in the light palette `text-success`/
  // `text-warning` on their own 10% fill measure 4.39:1 and 4.38:1, just under
  // AA's 4.5. `-strong` is the same hue with 6% black mixed in, which lands
  // them at 4.86:1. Contrast is size-independent — the pill's 12/14px text is
  // not "large text", so 4.5 is the bar at either size. `danger` needs no
  // nudge (5.45:1 on its own fill).
  //
  // `-tint`, not `/10`: a translucent fill contrasts against whatever is
  // *behind the pill*, and every number above assumed that was `--surface`. It
  // is not, on a page that renders a badge straight onto `--background`
  // (4.21:1 on `/reviews`) or inside a tinted row (4.09:1 on `/check-in`, a
  // primary pill on a boarded row's green). The tint token resolves against
  // `--surface` once and is opaque, so the pill is the number the palette
  // computed wherever it is mounted (issue #793).
  success: "bg-success-tint text-success-strong",
  warning: "bg-warning-tint text-warning-strong",
  danger: "bg-danger-tint text-danger",
  neutral: "border border-border bg-surface-sunken text-muted",
} as const;

export type BadgeTone = keyof typeof toneClass;

/**
 * The same mark, for a status that is **not** wearing a pill.
 *
 * A pill is right when a status needs to stand apart from body text. It is
 * wrong in a row of 44px controls, where a 24px pill reads as a shrunken
 * button rather than as a different kind of thing — which is what the
 * certification lists looked like, "Pending" boxed beside "Mark certified" and
 * "Delete". There the status belongs against the card it is about, and the
 * mark alone carries it. Returns `undefined` for the two tones that are labels
 * rather than statuses, so a caller cannot mark a count.
 *
 * The marks themselves, and the argument for emoji over text dingbats, live in
 * `./tone` — one declaration shared with `FormStatus` and `ShopNotice`.
 */
export function badgeToneGlyph(tone: BadgeTone): string | undefined {
  return toneGlyph(tone);
}

const sizeClass = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1 text-sm",
  // For the rare pill whose word is *critical text* — a status a person reads
  // to make a decision, which principles.md §2 floors at 16px. The trip
  // roster's readiness word is the first taker; a count or a supporting fact
  // never earns this size.
  lg: "px-3.5 py-1 text-base",
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
  const glyph = toneMark ? toneGlyph(tone) : undefined;
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
