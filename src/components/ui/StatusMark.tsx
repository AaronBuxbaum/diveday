/**
 * Drawn status marks shared by the staff surfaces.
 *
 * The mark is always decorative: the adjacent words or the control's accessible
 * name carry the meaning for assistive technology. Each shape remains distinct
 * in monochrome, so a status never depends on its colour alone (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 5).
 */
export type StatusMarkVariant =
  | "success"
  | "warning"
  | "danger"
  | "checked"
  | "unchecked"
  /** A hollow ring: a job not done yet, on a row whose kind is quiet. */
  | "pending";

const sizeClass = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
} as const;

/**
 * **The mark as the opening of a line of text**, for `inline`.
 *
 * A bare mark is an `<svg>`, and Tailwind's preflight makes every `svg`
 * `display: block`: written in front of its words it takes a line of its own
 * above them, and a margin on it spaces it from nothing (K-15 — every toned
 * `ShopNotice`, and the printed pre-departure list). This box is one line of
 * the surrounding text tall (`h-lh`), stands at the top of the line it opens
 * (`align-top`), and centres the mark in it — the middle of a line box, which
 * is where that line's capitals are centred. Not a `vertical-align` nudge on
 * the svg itself: the right nudge depends on the mark's size against the
 * text's, and this box is right at any of them.
 *
 * Exported for any glyph that stands in a run of text the same way — Today's
 * station title ends in its chevron on the last line it wraps to (K-464).
 */
export const INLINE_LINE_BOX = "inline-flex h-lh items-center align-top";

export function StatusMark({
  variant,
  size = "sm",
  inline = false,
  className = "",
}: {
  variant: StatusMarkVariant;
  size?: keyof typeof sizeClass;
  /** Stand in a line of text, centred on it — see `INLINE_LINE_BOX`. */
  inline?: boolean;
  /** Classes for the mark itself (its colour, usually), inline or not. */
  className?: string;
}) {
  const mark = drawMark(variant, `${sizeClass[size]} shrink-0 ${className}`.trim());
  return inline ? <span className={INLINE_LINE_BOX}>{mark}</span> : mark;
}

/**
 * **The mark as the first column of a row of text** — a notice, a blocker
 * line, a group band's fact: a `flex` row whose words are the next item.
 *
 * A bare mark heading a row has no line to sit on. In a stretched row it
 * stands at the top of the words' line, 2.5px above its centre on a 20px line
 * (K-494). And flex synthesizes a missing baseline from the mark's foot, so a
 * row that is itself a baseline for its parent hands that parent the foot: the
 * roster's group band sat its title 5px under the fact beside it (K-181).
 *
 * This column is a block (the row's flex item) holding the `inline` one-line
 * box: a real line of the row's own text, so a real first baseline, with the
 * mark centred on it. First in a row aligned `items-baseline`, it lines up
 * with the words' first line wherever that line is (`ShopNotice`, K-15).
 */
export function StatusMarkColumn(props: Omit<Parameters<typeof StatusMark>[0], "inline">) {
  return (
    <span className="shrink-0">
      <StatusMark {...props} inline />
    </span>
  );
}

function drawMark(variant: StatusMarkVariant, classes: string) {
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

  if (variant === "pending") {
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
