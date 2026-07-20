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
const base =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60";

const variants = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-primary hover:bg-surface-sunken",
  ghost: "text-muted hover:bg-surface-sunken hover:text-foreground",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
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

export function buttonClass({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`.trim();
}
