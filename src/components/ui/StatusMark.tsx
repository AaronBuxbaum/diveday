/**
 * Drawn status marks shared by the staff surfaces.
 *
 * The mark is always decorative: the adjacent words or the control's accessible
 * name carry the meaning for assistive technology. Each shape remains distinct
 * in monochrome, so a status never depends on its colour alone (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 5).
 */
export type StatusMarkVariant = "success" | "warning" | "danger" | "checked" | "unchecked";

const sizeClass = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
} as const;

export function StatusMark({
  variant,
  size = "sm",
  className = "",
}: {
  variant: StatusMarkVariant;
  size?: keyof typeof sizeClass;
  className?: string;
}) {
  const classes = `${sizeClass[size]} shrink-0 ${className}`.trim();

  if (variant === "success" || variant === "checked") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={classes}
      >
        {variant === "success" ? (
          <circle cx="12" cy="12" r="8.75" />
        ) : (
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
        )}
        <path d="m7.5 12.1 3 3 6-6.3" />
      </svg>
    );
  }

  if (variant === "unchecked") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={classes}
      >
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      </svg>
    );
  }

  if (variant === "danger") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={classes}
      >
        <circle cx="12" cy="12" r="8.75" />
        <path d="m8.5 8.5 7 7M15.5 8.5l-7 7" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={classes}
    >
      <path d="m12 3.75 8.7 15.5a1 1 0 0 1-.87 1.5H4.17a1 1 0 0 1-.87-1.5L12 3.75Z" />
      <path d="M12 9v4.75" />
      <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
