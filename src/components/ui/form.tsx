import {
  type ComponentPropsWithoutRef,
  cloneElement,
  type ElementType,
  isValidElement,
  type ReactNode,
  useId,
} from "react";
import { currencyFractionDigits, currencySymbol, maxPriceMajor, minorToMajor } from "@/lib/money";

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

/** Native form-control tags `Field` will clone an id/aria-describedby onto. */
const CONTROL_TAGS = new Set(["input", "select", "textarea"]);

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
  // A native form-control tag specifically, not just any single element — a
  // wrapping <div> (e.g. an input plus a "$" prefix, or a select plus its own
  // button) is also `isValidElement`, and cloning the auto id/aria-describedby
  // onto that wrapper instead of the real control it wraps leaves the label
  // pointing at an id nothing else has. The wrap-everything fallback below
  // handles those correctly via implicit label-wraps-control association.
  const isControl =
    isValidElement<ControlProps>(children) &&
    typeof children.type === "string" &&
    CONTROL_TAGS.has(children.type);
  const controlId = htmlFor ?? (isControl ? (children.props.id ?? autoId) : undefined);
  const isRequired = isControl && children.props.required === true;

  // The asterisk is aria-hidden and stays *outside* the `<label>` itself
  // (not just inside an aria-hidden span within it): a `<label>`'s own text
  // content is what test tooling matches a field by name against, and that
  // matching doesn't uniformly respect aria-hidden the way real accessible-
  // name computation does — nesting it inside would make an exact-text
  // match against "Name" miss a required field labelled "Name *".
  const requiredMarker = isRequired ? (
    <span aria-hidden="true" className="text-danger">
      {" "}
      *
    </span>
  ) : null;
  const captionContent = (
    <>
      {label}
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
      <span className="self-end">
        <label htmlFor={controlId}>{captionContent}</label>
        {requiredMarker}
      </span>
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
 * A price box in the shop's currency, prefilled from stored minor units. An
 * empty box means unpriced — the one price-entry pattern every form uses, so a
 * shop never sees `type="number"` inputs in one place and free-text decimals
 * in another.
 *
 * Everything currency-dependent here is derived, never assumed: the prefix is
 * the currency's own symbol rather than a literal `$`, the prefill divides by
 * the currency's minor unit rather than 100, and `step` follows the currency's
 * decimal places — a zero-decimal currency like JPY gets whole-number entry,
 * because `step="0.01"` would invite ¥1,234.56, which does not exist.
 *
 * `currency` and `locale` are both required rather than defaulted. A defaulted
 * currency is exactly how a page silently keeps charging dollars after the shop
 * switched (ADR 20260731-shop-currency), and a defaulted locale is the hard-coded
 * formatting `pnpm check:locale` exists to keep out — the caller has the
 * negotiated one in hand either way.
 */
export function PriceField({
  id,
  name,
  label,
  hint,
  cents,
  currency,
  locale,
}: {
  id?: string;
  name: string;
  label: string;
  hint?: string;
  cents: number | null;
  currency: string;
  locale: string;
}) {
  const digits = currencyFractionDigits(currency);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">{currencySymbol(currency, locale)}</span>
        <input
          id={id}
          name={name}
          type="number"
          inputMode="decimal"
          min={0}
          max={maxPriceMajor(currency)}
          step={digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`}
          defaultValue={cents === null ? "" : String(minorToMajor(cents, currency))}
          placeholder="—"
          className={controlClass}
        />
      </div>
    </Field>
  );
}
