import type { ReactNode } from "react";

/**
 * **The ledger's group label, in a module of its own.** `ledger.tsx` composes
 * it, but the ledger also carries the row menu and its icons; a client
 * component that wants only the label (the language picker, the identity menu,
 * the command palette) imports it from here, so the label does not bring the
 * row menu into every route that draws a picker (code review 2026-10-13b,
 * item 7). `scripts/perf-budget.mjs` fails a build whose shared floor carries
 * the row menu's `data-row-menu-open` again.
 */

/**
 * The inks a group label may be set in. `primary` is for the one group in a
 * run that is *current* — the week board's today column. `success` and
 * `warning` keep exceptional group headings in the same typography while
 * letting the state speak through ink; a group label is quiet by default.
 */
const GROUP_LABEL_INK = {
  muted: "text-muted",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning-strong",
  /** The one label set in danger ink: the home's "First thing" panel, naming the row that blocks a boat. */
  danger: "text-danger",
} as const;

/** Which ink a group label is set in. `muted` unless the group has a state to carry. */
export type GroupLabelTone = keyof typeof GROUP_LABEL_INK;

/**
 * The small-caps line that owns a group's shared facts. Settings' spelling,
 * now the only spelling.
 *
 * A function rather than a bare string because the ink is part of the
 * spelling: a caller that appended its own `text-primary` would be racing
 * `text-muted` in the emitted stylesheet, which Tailwind orders by token name
 * rather than by where the class was written (AGENTS.md's `buttonClass`
 * warning, the same failure at 31 call sites). Exported for callers that need
 * the spelling without changing their existing semantic element — table headers,
 * definition labels and compact group headings.
 */
export function groupLabelClass(tone: GroupLabelTone = "muted") {
  return `text-xs font-semibold tracking-[0.14em] ${GROUP_LABEL_INK[tone]} uppercase`;
}

/**
 * The quiet, tabular facts a group carries beside its label. One constant
 * because two places render it — `GroupLabel`'s own row, and a folded group's
 * `<summary>`, which lays the same three parts out itself so no flow element
 * has to be nested inside phrasing content (see `LedgerGroup`).
 */
export const GROUP_META_CLASS = "shrink-0 text-xs font-medium text-muted tabular-nums";

/** Heading levels a group label may be. `p` for chrome that is not page structure (a menu section). */
export type GroupLabelElement = "h2" | "h3" | "h4" | "p";

export function GroupLabel({
  children,
  meta,
  as: Label = "p",
  id,
  tone = "muted",
  className = "",
}: {
  /** The label text. */
  children: ReactNode;
  /** Right-aligned quiet facts a group owns for its rows ("3 orders · $412.75"). Tabular. */
  meta?: ReactNode;
  /** The heading level when the group is a section of the page. */
  as?: GroupLabelElement;
  /** For the `aria-labelledby` of the list this labels, and for a fragment target. */
  id?: string;
  /** `primary` for the one group in a run that is current; quiet otherwise. */
  tone?: GroupLabelTone;
  className?: string;
}) {
  // `className` lands on the label element in both shapes, never on the
  // wrapper: a call site's `scroll-mt-24` has to sit on the element the
  // fragment actually targets, and its `px-2` has to indent the words rather
  // than a flex box that may not exist.
  const label = (
    <Label id={id} className={`${groupLabelClass(tone)} ${className}`.trim()}>
      {children}
    </Label>
  );
  if (meta == null) return label;
  return (
    <div className="flex items-baseline justify-between gap-3">
      {label}
      <span className={GROUP_META_CLASS}>{meta}</span>
    </div>
  );
}
