import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/**
 * Canonical form primitives.
 *
 * Multi-column forms used to misalign: each field was its own `flex flex-col`
 * stack, so a caption that wrapped to two lines ("Email (optional)") pushed its
 * control below the neighbouring one. `FieldGrid` declares two rows per field
 * row — captions, then controls — and `Field` subgrids onto them, so controls
 * line up no matter how the captions wrap.
 *
 * Rendering a stacked label by hand re-introduces that bug — reach for `Field`.
 * See docs/design/forms-and-controls.md.
 */

/** Shared control styling for inputs, selects, and textareas. */
export const controlClass =
  "min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal transition-colors focus:border-primary";

const columnClass = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

export type FieldGridColumns = keyof typeof columnClass;

/**
 * Grid wrapper for a row (or block) of `Field`s. Each field occupies two rows —
 * caption and control — which is what lets `Field` subgrid onto them.
 */
export function FieldGrid({
  columns = 1,
  className = "",
  as = "div",
  children,
  ...rest
}: {
  columns?: FieldGridColumns;
  className?: string;
  /** Render the grid as the `<form>` itself when there is nothing to nest it in. */
  as?: "div" | "form" | "fieldset";
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"form">, "className" | "children">) {
  // Callers stay typed by the props above; inside, the tag is only known as a
  // union, so JSX would intersect the three elements' attribute types.
  const Tag = as as ElementType;
  return (
    <Tag
      className={`grid grid-cols-1 gap-x-4 gap-y-4 ${columnClass[columns]} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A labelled control. Pass the control itself as `children`; the caption goes
 * through `label`/`hint` so the component keeps ownership of the two-row shape.
 */
export function Field({
  label,
  hint,
  description,
  htmlFor,
  className = "",
  children,
}: {
  label: ReactNode;
  /** Short qualifier rendered inline after the label, e.g. "(optional)". */
  hint?: ReactNode;
  /** Longer helper text rendered under the control. */
  description?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`row-span-2 grid grid-rows-subgrid gap-y-1 text-sm font-medium ${className}`}
    >
      <span className="self-end">
        {label}
        {hint ? <span className="font-normal text-muted"> {hint}</span> : null}
      </span>
      <span className="grid gap-1">
        {children}
        {description ? <span className="text-xs font-normal text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Submit row for a `FieldGrid`; spans every column and centers its buttons. */
export function FieldActions({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`col-span-full flex flex-wrap items-center gap-3 ${className}`}>{children}</div>
  );
}
