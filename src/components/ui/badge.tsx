/**
 * Canonical status pill. Every hand-rolled "rounded-full bg-X/10 text-X" span
 * across the staff app was a slightly different copy of this shape — this is
 * the one to reach for instead, so a diver-ready pill and an order-status pill
 * read as the same kind of thing everywhere they appear.
 */

const toneClass = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "border border-border bg-surface-sunken text-muted",
} as const;

export type BadgeTone = keyof typeof toneClass;

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
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClass[size]} ${
        toneClass[tone]
      }${tabularNums ? " tabular-nums" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}
