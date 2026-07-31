import {
  type ComponentPropsWithoutRef,
  cloneElement,
  type ElementType,
  isValidElement,
  type ReactNode,
  useId,
} from "react";

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

/** The subset of a control's props `Field` reads or writes when it clones it. */
type ControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
};

/**
 * A labelled control. Pass the control itself as `children`; the caption goes
 * through `label`/`hint` so the component keeps ownership of the two-row shape.
 *
 * Two things happen automatically when `children` is a single control element
 * (an `<input>`/`<select>`/`<textarea>` — the documented contract):
 *
 * - **Required marker.** A control rendered with `required` gets a visible
 *   `*` next to its label. It's `aria-hidden` — the control's own native
 *   `required` attribute is what a screen reader announces, this is purely
 *   the sighted cue (docs ADR/forms-and-controls.md: "required unless marked
 *   optional" would need touching ~150 call sites; auto-detecting from the
 *   control's own `required` prop needed none).
 * - **`aria-describedby` wiring.** `description` used to render *inside* the
 *   `<label>` alongside the control, which folds its whole text into the
 *   control's accessible *name* (screen readers read hint/description text
 *   every time the field is announced, not once as a description). `Field`
 *   now gives the description its own id and clones it onto the control via
 *   `aria-describedby` (merged with anything the caller already set, e.g. a
 *   field-specific error id), and moves the caption `<label>` to wrap only
 *   itself — associated to the control by `htmlFor`/`id`, not by nesting the
 *   description inside it. A caller-supplied `htmlFor`/matching child `id`
 *   is preserved as-is; otherwise `Field` mints one with `useId()`.
 *
 * A `children` that isn't a single element (rare — the documented contract is
 * "pass the control itself") falls back to the original wrap-everything
 * shape, so nothing breaks; it just doesn't get the two behaviors above.
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
  /** Longer helper text rendered under the control, referenced via `aria-describedby`. */
  description?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const descriptionId = description ? `${autoId}-description` : undefined;
  const isControl = isValidElement<ControlProps>(children);
  const controlId = htmlFor ?? (isControl ? (children.props.id ?? autoId) : undefined);
  const isRequired = isControl && children.props.required === true;

  const captionContent = (
    <>
      {label}
      {isRequired ? (
        <span aria-hidden="true" className="text-danger">
          {" "}
          *
        </span>
      ) : null}
      {hint ? <span className="font-normal text-muted"> {hint}</span> : null}
    </>
  );
  const descriptionSpan = description ? (
    <span id={descriptionId} className="text-xs font-normal text-muted">
      {description}
    </span>
  ) : null;

  if (!isControl) {
    // No single control element to clone an id/aria-describedby onto — fall
    // back to implicit label-wraps-everything association.
    return (
      <label
        htmlFor={htmlFor}
        className={`row-span-2 grid grid-rows-subgrid gap-y-1 text-sm font-medium ${className}`}
      >
        <span className="self-end">{captionContent}</span>
        <span className="grid gap-1">
          {children}
          {descriptionSpan}
        </span>
      </label>
    );
  }

  const control = cloneElement(children, {
    id: controlId,
    "aria-describedby":
      [children.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined,
  });

  return (
    <div className={`row-span-2 grid grid-rows-subgrid gap-y-1 text-sm font-medium ${className}`}>
      <label htmlFor={controlId} className="self-end">
        {captionContent}
      </label>
      <span className="grid gap-1">
        {control}
        {descriptionSpan}
      </span>
    </div>
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

/**
 * A dollar price box, prefilled from stored minor units. An empty box means
 * unpriced — the one price-entry pattern every form uses, so a shop never
 * sees `type="number"` inputs in one place and free-text decimals in
 * another.
 */
export function PriceField({
  id,
  name,
  label,
  hint,
  cents,
}: {
  id?: string;
  name: string;
  label: string;
  hint?: string;
  cents: number | null;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">$</span>
        <input
          id={id}
          name={name}
          type="number"
          inputMode="decimal"
          min={0}
          max={100000}
          step="0.01"
          defaultValue={cents === null ? "" : String(cents / 100)}
          placeholder="—"
          className={controlClass}
        />
      </div>
    </Field>
  );
}
