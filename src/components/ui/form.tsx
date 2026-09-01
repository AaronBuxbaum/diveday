import {
  Children,
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  cloneElement,
  type ElementType,
  isValidElement,
  type ReactNode,
  useId,
} from "react";
import { currencyFractionDigits, currencySymbol, maxPriceMajor, minorToMajor } from "@/lib/money";
import { type NoticeTone, noticeRole } from "@/lib/staff-notices";
import { StatusMark } from "./StatusMark";
import { toneMark } from "./tone";

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

/**
 * **The one search box** — a `type="search"` control wearing `controlClass`,
 * a magnifier in its leading inset, and its label off-screen.
 *
 * Every staff list that can be searched renders this and nothing else around
 * it: no caption above the box, no "Search" button beside it. Four grammars
 * used to coexist — the orders toolbar's bare box, the diver roster's bare box,
 * the dive-site library's bordered card with a "Find a site" caption and a
 * Search button, and the counter's captioned box with a "Search queue" button
 * — and which one a page got was a function of when it was written. The
 * Clearwater decision that demoted the orders filter card to a toolbar (ADR
 * 20260827-clearwater-surface-language, decision 7) is the precedent: a search
 * is a toolbar control, and the glyph is what says so.
 *
 * The label is `sr-only` because the glyph and the placeholder already say
 * "search" to a sighted reader, and a caption restating them is what
 * copy-restraint deletes — but the accessible name is not the sighted reader's
 * convenience and stays. No submit button: a form with one text control
 * submits on Enter, and the surfaces that want type-to-apply drive
 * `requestSubmit()` themselves through `onInput`.
 *
 * Every native input prop passes through — `ref`, `value`/`onChange` for a
 * controlled box, `defaultValue` for a form-owned one, `data-*` hooks the e2e
 * suite waits on — so a surface never has a reason to spell the box by hand.
 */
export function SearchField({
  id,
  label,
  className = "",
  ...input
}: {
  id: string;
  /** The accessible name — "Search divers", "Scan or search diver". */
  label: string;
  /** Sizes the box. `controlClass` already sets `w-full`; the wrapper decides the width. */
  className?: string;
} & Omit<ComponentPropsWithRef<"input">, "id" | "type" | "className" | "children">) {
  return (
    <div className={`relative ${className}`.trim()}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      {/* The same magnifier the ⌘K trigger draws, so a search box and the
          search door share one face. Positioned on the input's own inset and
          inert, so a tap on it lands in the box. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        id={id}
        type="search"
        inputMode="search"
        autoComplete="off"
        maxLength={120}
        {...input}
        className={`${controlClass} ps-9`}
      />
    </div>
  );
}

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
  name?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/**
 * `useId()`, made unique against the counter restart that PPR causes.
 *
 * **The bug this exists for.** With `cacheComponents` on, a client-side
 * navigation resumes a prerendered static shell and streams the dynamic content
 * beside it — two render passes, each starting React's server `useId` counter
 * at 1. So a `Field` in the shell and a `Field` in the resumed body can be
 * handed the *same* id (`_S_2_`), and `<label for>` then resolves to whichever
 * comes first in the document. What breaks is only the accessible *name*: a
 * screen reader announces the two labels concatenated, the DOM looks correct in
 * a diff and in a screenshot, and no assertion notices (issue #1022).
 *
 * Measured on 16.3.3 (the latest release; there is no upstream fix to take):
 * a **hard load** of the manifest at `?checkpoint=after_dive_1` is clean, and
 * clicking board → trip → Manifest → After dive 1 to the same URL puts seven
 * duplicate ids in the document — the dive log's "Maximum depth", "Entered the
 * water", "Exited the water", "Visibility" and "Current" each sharing an id
 * with a field of the collapsed trip-edit disclosure. That is a divemaster's
 * dive log at the rail, so it is worth not waiting for.
 *
 * **The fix, and its limit.** A control's `name` is unique within its form and
 * stable across both passes, so folding it into the id separates every pair the
 * two counters can produce — `_S_2_-maxDepthMeters` and `_S_2_-title` cannot
 * collide however the counters land. It is not a proof: two `Field`s that share
 * a `name` *and* land on the same counter value would still collide, and a
 * `Field` whose control has no `name` keeps the bare id. That residue is what
 * `expectNoA11yViolations` (e2e/a11y.spec.ts) is for — it fails on any
 * duplicate id, and it is what would have caught this years earlier.
 */
function scopedFieldId(autoId: string, name: string | undefined): string {
  if (!name) return autoId;
  // Ids may not contain whitespace, and a `name` may (`person[0].note`), so
  // anything outside the safe set becomes an underscore.
  return `${autoId}-${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

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
 * **The minted id is scoped, and then checked.** Issue #1022 reported two
 * `Field`s sharing one `useId()` value under `cacheComponents`, which makes a
 * screen reader announce a name built from both labels while the DOM, the
 * screenshots and every existing assertion stay correct. It is real, and it
 * needs a **client-side navigation** to show up — a hard load of the same URL
 * is clean, which is why a sweep of 229 hard-loaded renders found nothing.
 * `scopedFieldId` below is the fix and carries the measurement;
 * `expectNoA11yViolations` in e2e/a11y.spec.ts is the net under it, failing on
 * any duplicate DOM id. axe cannot do that itself: it dropped
 * `duplicate-id`/`duplicate-id-active` in 4.9 and the surviving
 * `duplicate-id-aria` never fires on a plain `<label for>`.
 *
 * A `children` that isn't a single element (rare — the documented contract is
 * "pass the control itself") falls back to the original wrap-everything
 * shape, so nothing breaks; it just doesn't get the two behaviors above.
 */
export function Field({
  label,
  hint,
  aside,
  description,
  error,
  htmlFor,
  markRequired = true,
  className = "",
  children,
}: {
  label: ReactNode;
  /**
   * Whether a `required` control gets the visible `*`. Default true. Set false
   * only where every field in the form is required, so the marker distinguishes
   * nothing — see the note beside `isRequired` below. Never a way to hide that
   * a field is required from a form that also has optional ones.
   */
  markRequired?: boolean;
  /** Short qualifier rendered inline after the label, e.g. "(optional)". */
  hint?: ReactNode;
  /**
   * A marker rendered on the caption row but *outside* the `<label>` — an
   * `InfoHint` and nothing else, so far. It stays out of the label because a
   * label's text content is the control's accessible name, and because a click
   * anywhere in a `<label>` is forwarded to the control it labels.
   *
   * The fallback branch below (a `children` that isn't a single native control)
   * has only one element, the `<label>` itself, so an `aside` there does end up
   * nested inside it and inherits that forwarding. Pass `aside` with a real
   * `<input>`/`<select>`/`<textarea>`.
   */
  aside?: ReactNode;
  /** Longer helper text rendered under the control, referenced via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Why *this field* was refused, in the shop's language — rendered under the
   * control in a `role="alert"` region, and wired onto the control itself as
   * `aria-invalid` plus an `aria-describedby` reference. Pass a falsy value
   * when the field is fine; nothing renders and nothing is wired.
   *
   * This is the field half of the rule that a refusal belongs where the work
   * is, not in a banner at the top of the page (`FormStatus` is the form half).
   * Before it existed, every surface that wanted a per-field message hand-rolled
   * the id/`aria-describedby`/`aria-invalid` triple at the call site — twice
   * over in `BookingPartyFields`/`BookingSections`, and not at all anywhere
   * else, which is how a twenty-field editor ended up with one generic banner.
   */
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
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
  const fieldId = scopedFieldId(useId(), isControl ? children.props.name : undefined);
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const controlId = htmlFor ?? (isControl ? (children.props.id ?? fieldId) : undefined);
  // `markRequired={false}` opts a field out of the asterisk without touching
  // the control's own `required` (the server refusal it pairs with is real).
  // For a form whose *every* field is required and where the marker therefore
  // distinguishes nothing — a one-field "add a member" row, say. Used sparingly:
  // the marker's whole job is telling required apart from optional, so silencing
  // it on a form that has both would be a lie rather than a tidy-up.
  const isRequired = isControl && children.props.required === true && markRequired;

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
  // `role="alert"` on the message itself rather than an always-mounted wrapper:
  // every refusal in this app arrives by a fresh render (a server redirect, or
  // a `useActionState` update), so the node is *inserted* carrying its text,
  // which is what an alert region announces. Same shape as `ImageFileInput`'s
  // client-side refusal, so both sound identical.
  const errorSpan = error ? (
    <span id={errorId} role="alert" className="text-xs font-medium text-danger">
      {error}
    </span>
  ) : null;

  if (!isControl) {
    // No single control element to clone an id/aria-describedby onto. An
    // explicit `htmlFor` says the caller has already named the control, so the
    // caption is a plain sibling `<label>`; without one, fall back to implicit
    // label-wraps-everything association.
    //
    // The split matters for a child that renders a `<label>` of its own —
    // `ImageFileInput`, whose button *is* a label wrapping the file input.
    // Nesting one label inside another is invalid HTML, and a click in the
    // overlap has two controls to forward to.
    const rows = `row-span-2 grid grid-rows-subgrid gap-y-1 text-sm font-medium ${className}`;
    const body = (
      <span className="grid content-start gap-1">
        {children}
        {descriptionSpan}
        {errorSpan}
      </span>
    );
    return htmlFor ? (
      <div className={rows}>
        <span className="self-end">
          <label htmlFor={htmlFor}>{captionContent}</label>
          {aside}
        </span>
        {body}
      </div>
    ) : (
      // biome-ignore lint/a11y/noLabelWithoutControl: the wrapping branch — the control is `children`, which the rule cannot see through
      <label className={rows}>
        <span className="self-end">
          {captionContent}
          {aside}
        </span>
        {body}
      </label>
    );
  }

  const control = cloneElement(children, {
    id: controlId,
    "aria-describedby":
      [children.props["aria-describedby"], descriptionId, errorId].filter(Boolean).join(" ") ||
      undefined,
    // Never *clear* a caller's own `aria-invalid` — a field can be invalid for
    // a reason this `Field` was not told about (a client-side check that owns
    // the attribute itself), so an absent `error` leaves whatever it set.
    "aria-invalid": error ? "true" : children.props["aria-invalid"],
  });

  return (
    <div className={`row-span-2 grid grid-rows-subgrid gap-y-1 text-sm font-medium ${className}`}>
      <span className="self-end">
        <label htmlFor={controlId}>{captionContent}</label>
        {requiredMarker}
        {aside ? <span className="ml-1.5">{aside}</span> : null}
      </span>
      {/* `content-start`: the control row is a subgrid track shared with every
          other field on this row, so it is as tall as the *longest* neighbour's
          description. Without it the spare height stretches the control itself,
          and a field whose neighbour has a three-line description renders a
          52px box next to its 44px sibling. Keep the control at its own height
          and let the slack fall below the description. */}
      <span className="grid content-start gap-1">
        {control}
        {descriptionSpan}
        {errorSpan}
      </span>
    </div>
  );
}

/**
 * **The submit row of a form longer than a screen, pinned to the bottom edge.**
 *
 * `FieldActions` below is right for a form you can see all of. This one is for
 * the ones you cannot: the course editor runs to **4,002 px** at desktop
 * width across nine sections, and its only Save sat at the very bottom — so
 * fixing a typo in the subhead at y≈300 meant scrolling 3,700 px to commit it,
 * and a writer who did not know that was there had no way to tell the form
 * from a page (issue #815).
 *
 * `sticky`, not `fixed`: it belongs to the form, so it rides the bottom of the
 * viewport while the form is on screen and settles into place at the end of
 * it. A fixed bar would hang over every other page's footer too. When this
 * lives in the staff shell, `--dock-clearance` is the same space the phone
 * dock reserves for page content, so the action row stays above that dock on
 * a short phone or small laptop instead of being hidden behind it.
 *
 * The negative margins let it span the full width of a padded container while
 * its own padding keeps the buttons where the fields are. Reach for it when a
 * form is taller than a phone screen with content still to come — a two-field
 * panel wearing one is a bar hovering over nothing.
 */
export function StickyFormActions({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`sticky bottom-[var(--dock-clearance,0rem)] z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5 ${className}`}
    >
      {children}
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
 * `-strong` for the two hues that need it. A `FormStatus` sits in whatever
 * container its form does, and the light palette's raw `text-success`/
 * `text-warning` clear AA on `bg-surface` (5.02:1) but fail on
 * `bg-surface-sunken` (4.36:1) — and a disclosed settings row, a sunken inset
 * panel, and a card's footer are all places a form's action row lands. `-strong`
 * clears both (5.54:1 / 4.82:1), so the component does not have to know where
 * it was mounted. This is the surface that tells a staffer their save was
 * refused; it does not get to be the one that guessed. Numbers in
 * docs/design/forms-and-controls.md.
 */
const STATUS_TONE: Record<NoticeTone, string> = {
  success: "text-success-strong",
  danger: "text-danger",
  warning: "text-warning-strong",
  neutral: "text-muted",
};

/**
 * How a form says what happened, **where the form is**.
 *
 * Staff surfaces here overwhelmingly answer a save by redirecting back with a
 * `?notice=` code, which one page-level banner under the `<h1>` then resolves.
 * That reads fine on a one-form page and badly everywhere else: the trip
 * Overview alone has six independent forms down a long page, so saving the
 * requirements block — or being refused by it — put the answer somewhere the
 * staffer had scrolled past minutes ago. Worse, the last-minute-deal refusal
 * redirects to `#last-minute-deal`, which *scrolls the banner off screen* on
 * the way in.
 *
 * `FormStatus` is the fix, and it is deliberately not another banner: it is one
 * line of tone-coloured text that lives in the form's own action row, beside
 * the button that was just pressed. The rule it encodes:
 *
 * - a **form-level** outcome (this save was refused, this save worked) renders
 *   here, adjacent to the submit control;
 * - a **field-level** refusal renders on the field, via `Field`'s `error` prop;
 * - the page-level banner is left for things that are genuinely about the page
 *   rather than about one form — a permission refusal that bounced the staffer
 *   here from somewhere else, say.
 *
 * `role` follows the shared tone→role rule (`noticeRole`): a refusal is an
 * `alert`, a confirmation is a `status`. Nothing renders when there is no
 * message, so a form's action row keeps its exact resting layout.
 */
export function FormStatus({
  tone = "danger",
  id,
  className = "",
  children,
}: {
  tone?: NoticeTone;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  // **`Children.toArray`, not `!children`.** The falsy check held only while
  // every caller passed exactly one expression: `{undefined}` is falsy, but
  // `{undefined}{null}` is an *array*, which is truthy — so a caller that
  // appended a conditional second child rendered a bare status mark with no
  // message
  // beside it, on a page at rest, and nothing failed. `Children.toArray` drops
  // null, undefined and booleans, which is precisely the question being asked
  // (found on the waiver editor, issue #790).
  if (Children.toArray(children).length === 0) return null;
  const mark = toneMark(tone);
  return (
    <p
      id={id}
      role={noticeRole(tone)}
      className={`flex items-baseline gap-1.5 text-sm font-medium ${STATUS_TONE[tone]} ${className}`}
    >
      {mark ? <StatusMark variant={mark} /> : null}
      <span>{children}</span>
    </p>
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
