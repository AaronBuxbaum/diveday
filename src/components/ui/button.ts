/**
 * Canonical classes for buttons and button-shaped links.
 *
 * Every variant is `inline-flex items-center justify-center`. That is not
 * decoration: our touch targets set a `min-h-*` floor, and a plain block or
 * inline box leaves the label sitting at the top of that taller box instead of
 * centered in it. Use this instead of hand-written class strings so centering is
 * structural rather than remembered. See docs/design/forms-and-controls.md.
 */

/**
 * Type scale lives on the sizes, not here. Two competing font-size utilities in
 * one class list resolve by stylesheet order, not by the order you wrote them,
 * so a `text-base` passed through `className` cannot reliably beat a `text-sm`
 * baked in here. Keeping exactly one of each means nothing has to fight.
 */
/**
 * `cursor-pointer` is on the base, not on call sites. Tailwind v4's Preflight
 * dropped the v3 rule that gave `button` a pointer cursor, so every
 * `<button>` in the app has been rendering the default arrow — invisible in a
 * screenshot, and exactly the "is this even clickable?" hesitation an icon-only
 * control can least afford (found on the course roster's eye toggle). Links
 * already get it from the browser; putting it here is what makes buttons and
 * button-shaped links behave alike. `disabled:cursor-not-allowed` still wins on
 * a disabled button — its variant selector carries the higher specificity.
 */
const base =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-lg transition-[color,background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

const variants = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-primary hover:bg-surface-sunken",
  ghost: "text-muted hover:bg-surface-sunken hover:text-foreground",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
  /**
   * A destructive choice sitting among quiet siblings — a disclosed action
   * list's "Remove" next to ghost-weight items. The bordered `danger` shouts
   * inside a small menu; this keeps the warning hue without the box.
   */
  "danger-ghost": "text-danger hover:bg-danger/10",
  "danger-solid": "bg-danger text-primary-foreground hover:bg-danger/90",
  /** Reads as inline text, but still claims a full touch target. */
  link: "text-primary hover:underline",
} as const;

const sizes = {
  sm: "px-3 py-2 text-sm font-medium",
  md: "px-4 py-2.5 text-sm font-medium",
  lg: "px-5 py-2.5 text-sm font-medium",
  /** Marketing calls to action: reads at 16px and carries more weight. */
  cta: "px-5 py-3 text-base font-semibold",
  /** Dock target: a 56px, 16px-label action for wet-hands boat surfaces. */
  boat: "min-h-14 px-6 py-3.5 text-base font-semibold",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

/**
 * The horizontal padding, dropped. For a `link`-variant button that has to sit
 * flush with the prose it belongs to — a "See the full list →" under a
 * checklist, a guide link under the claim it cites — where the size's `px-*`
 * reads as an unexplained indent.
 *
 * It is an option rather than something a caller passes through `className`
 * because passing it there **does not work**, for the same reason the type
 * scale lives on the sizes: two utilities for one property resolve by
 * stylesheet order, not by the order you wrote them, and Tailwind emits `px-0`
 * before `px-4`, so the size always wins. Three links on `/pricing` rendered 12
 * measured pixels inside the text above them while asking for `px-0`.
 *
 * Vertical padding and `min-h-11` stay: the touch target is why the padding is
 * there at all, and only the horizontal half is what misaligns the text.
 */
const FLUSH = "px-0";
const HORIZONTAL_PADDING = /\bpx-[^\s]+/g;

export function buttonClass({
  variant = "primary",
  size = "md",
  flush = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Drop the size's horizontal padding so the label sits flush with adjacent text. */
  flush?: boolean;
  className?: string;
} = {}) {
  const sizeClasses = flush
    ? `${sizes[size].replace(HORIZONTAL_PADDING, " ").replace(/\s+/g, " ").trim()} ${FLUSH}`
    : sizes[size];
  return `${base} ${variants[variant]} ${sizeClasses} ${className}`.trim();
}
