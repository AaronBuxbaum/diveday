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
import { StatusInView } from "@/components/ui/StatusInView";
import { currencySymbol, minorToMajor } from "@/lib/money";
import { type NoticeTone, noticeRole } from "@/lib/staff-notices";
import { type ForgivingCopy, ForgivingInput } from "./ForgivingInput";
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

/**
 * **How tall a text control stands, named for what it stands beside.**
 *
 * A control's type is 16px at every size, because iOS Safari zooms the whole
 * page when a box under 16px takes focus. So the control can only ever be
 * level with a button whose label is 16px too, and `buttonClass`'s `md` is
 * that button: 48px with a 16px label. `sm` is 44px with a 14px label and
 * never matches a control, whatever its height.
 *
 * - `field`, the default: 44px, the target floor. A control stacked in a
 *   `Field` whose line holds no button, alone in a toolbar, or in a row of
 *   controls only (the orders toolbar's search and selects).
 * - `md`: 48px. A control that shares a line with `md` buttons or `icon`
 *   squares, inside a `Field` or not: a search beside its "Add diver", the
 *   reports month box between its arrows, a rename box beside its Save, a
 *   `Field`'s box beside its form's submit. **A row with a text control in
 *   it is an `md` row.**
 *
 * The pixel probe found the two apart on 2026-09-25 (the `mismatched-controls`
 * cluster): a 44px search box beside a 48px "Add diver" on seventeen trip
 * captures and the roster, and a 16px box beside a 14px "Go" or "Save"
 * wherever a row reached for `sm` to match the box's height.
 *
 * Each size spells its own vertical padding with its height, so the content
 * box is 26px at both. A text box centres its line at any height, but a native
 * file picker lays its button at the top of the content box, and would sit
 * high in a 48px box still padded for 44.
 */
const controlSizes = {
  field: "min-h-11 py-2",
  md: "min-h-12 py-2.5",
} as const;

export type ControlSize = keyof typeof controlSizes;

/**
 * `placeholder-shown:text-ellipsis`: a placeholder longer than its box ends
 * in "…" rather than being cut mid-word at the padding edge ("…along the c"
 * on the dive-site editor at 390, the pixel probe). Only while the
 * placeholder shows — typed text scrolls as it always has.
 */
const controlBody =
  "w-full rounded-lg border border-border-strong bg-surface px-3 text-base font-normal transition-colors placeholder-shown:text-ellipsis focus:border-primary";

/** Shared control styling at a size — see `controlSizes` for which size a row takes. */
export function controlClassFor(size: ControlSize): string {
  return `${controlSizes[size]} ${controlBody}`;
}

/** Shared control styling for inputs, selects, and textareas, at the `field` size. */
export const controlClass = controlClassFor("field");

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
 *
 * `size="md"` where the box shares a line with an `md` button, as the diver
 * roster's and the seat-diver picker's do with their "Add diver"; the default
 * everywhere else (`controlSizes` says why).
 */
export function SearchField({
  id,
  label,
  size = "field",
  className = "",
  ...input
}: {
  id: string;
  /** The accessible name — "Search divers", "Scan or search diver". */
  label: string;
  /** The row's size: `md` beside an `md` button, the default anywhere else. */
  size?: ControlSize;
  /** Sizes the box. `controlClass` already sets `w-full`; the wrapper decides the width. */
  className?: string;
} & Omit<ComponentPropsWithRef<"input">, "id" | "type" | "className" | "children" | "size">) {
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
        className={`${controlClassFor(size)} ps-9`}
      />
    </div>
  );
}

/**
 * **A date box that looks like one on every platform** — a `type="date"`
 * control wearing `controlClass`, with our own calendar glyph in its trailing
 * inset (issue #1415).
 *
 * A bare `<input type="date">` is drawn by the platform, and the platforms
 * disagree about whether an empty one shows anything at all. Chromium paints
 * `mm/dd/yyyy` *and* its own calendar indicator; **iOS Safari paints neither**
 * — an empty date field there is a blank rounded rectangle, indistinguishable
 * from the text boxes above it, with no cue that tapping it opens a picker.
 * The glyph is ours so the box reads the same everywhere, and it is why every
 * date input in the app renders this rather than spelling itself.
 *
 * **`opacity-0`, never `hidden`.** Chromium's own indicator stays in the
 * layout underneath ours, so a Chromium tap on that spot still opens the
 * native picker; `display: none` would take the tap target away with the
 * pixels and leave the glyph looking live and doing nothing. Which is also
 * why `pe-9` and `end-3` are a pair: drift them apart and the visible glyph
 * stops sitting over the real control.
 *
 * Firefox draws a calendar icon of its own and exposes no pseudo-element to
 * hide it, so a Firefox reader sees two. Known and accepted — there is no CSS
 * that reaches it, and the alternative is measuring the browser in JavaScript
 * to hide our own glyph, which costs more than the duplicate.
 *
 * Every native prop passes through — `min`/`max`, `value`/`onChange`,
 * `defaultValue`, and a callback `ref` (the schedule builder focuses one on
 * mount) — so a surface never has a reason to reach past this.
 */
export function DateField({
  className = "",
  wrapperClassName = "",
  ...input
}: {
  /** Extra classes on the input itself, e.g. `tabular-nums`. */
  className?: string;
  /** Sizes the wrapper; `controlClass` already sets `w-full` on the input. */
  wrapperClassName?: string;
} & Omit<ComponentPropsWithRef<"input">, "type" | "className">) {
  return (
    <div className={`relative ${wrapperClassName}`.trim()}>
      <input
        {...input}
        type="date"
        className={`${controlClass} pe-9 [&::-webkit-calendar-picker-indicator]:opacity-0 ${className}`.trim()}
      />
      {/* Inert and aria-hidden, like SearchField's magnifier: the input's own
          accessible name says what it is, and a tap here must reach the
          control rather than the decoration. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 11h18" />
      </svg>
    </div>
  );
}

/**
 * **The legend of a bordered `<fieldset>`**, whose words sit in a notch cut
 * in the box's top border. `px-1` pads the notch so the border stops short of
 * the words; `-ms-1` pulls the whole legend back by the same 4px, so the
 * words start on the content edge every field under them starts on. `px-1`
 * alone moved them 4px right of the fields (the pixel probe, orders-new:
 * legend text at 326, fields at 322). Type classes stay the caller's.
 */
export const legendClass = "-ms-1 px-1";

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
 *
 * **The column gutter is this component's, and only this component's.** Call
 * sites that appended `gap-x-5` won by stylesheet order, so two forms on one
 * settings page stood their columns 20px and 16px apart (the pixel probe,
 * settings-dock-day-rhythm against settings-emergency). A form that ever
 * wants another gutter gets a prop here; `form.test.tsx` refuses a `gap-x-*`
 * on a `FieldGrid`'s `className`.
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
 *
 * **`min-w-0`, on both branches.** A grid item's `min-width` is `auto`, which
 * is the item's own *content* minimum — so a control whose intrinsic minimum
 * is wider than its track pushes the field past it rather than shrinking, and
 * `w-full` on the control then measures the widened field. `input[type=date]`
 * is exactly that control on iOS Safari, where the rendered date is drawn by
 * the platform at a width nothing in this stylesheet sets: on the date-request
 * form it made the two date boxes visibly wider than the name, email, phone
 * and party boxes stacked directly above them (reported 2026-09-06), because
 * the dates sit in their own nested `FieldGrid` and so had a track of their own
 * to stretch. Tailwind's `grid-cols-*` tracks are already `minmax(0, 1fr)`;
 * this is the other half of that, and it belongs here rather than at a call
 * site because every grid of fields in the app wants it.
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
  //
  // `ForgivingInput` counts as a control too: it forwards `id`, `required` and
  // the aria attributes onto the visible box it renders, so the label can point
  // at that box by id and the required marker can read the `required` off it.
  // Left to the fallback, a required "Full name" lost its `*` the day the box
  // became forgiving (found by the diver-record visual capture).
  //
  // `DateField` joins them for exactly that reason and no other: it is an
  // `<input>` inside a positioning wrapper, so the tag test above cannot see
  // it, and the fallback would silently drop the `*` from the thirteen date
  // fields rendered `required` and stop `description`/`error` reaching four
  // more. A composite control that forwards these props belongs in this set;
  // one that does not belongs in the fallback.
  const isControl =
    isValidElement<ControlProps>(children) &&
    ((typeof children.type === "string" && CONTROL_TAGS.has(children.type)) ||
      children.type === ForgivingInput ||
      children.type === DateField);
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
  // `empty:hidden` for a description that is a component with nothing to say
  // yet: the onboarding form's storefront link renders nothing until there is
  // a slug to show, and its empty slot still took the body's 4px gap under
  // the control (the pixel probe, onboard). The slot stays mounted, so
  // `aria-describedby` keeps its target, and takes no room while it is empty.
  const descriptionSpan = description ? (
    <span id={descriptionId} className="text-xs font-normal text-muted empty:hidden">
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
    const rows = `row-span-2 grid min-w-0 grid-rows-subgrid gap-y-1 text-sm font-medium ${className}`;
    const body = (
      <span className="grid content-start gap-1">
        {children}
        {descriptionSpan}
        {errorSpan}
      </span>
    );
    return htmlFor ? (
      <div className={rows}>
        <span className="self-end text-pretty">
          <label htmlFor={htmlFor}>{captionContent}</label>
          {aside}
        </span>
        {body}
      </div>
    ) : (
      // biome-ignore lint/a11y/noLabelWithoutControl: the wrapping branch — the control is `children`, which the rule cannot see through
      <label className={rows}>
        <span className="self-end text-pretty">
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
    <div
      className={`row-span-2 grid min-w-0 grid-rows-subgrid gap-y-1 text-sm font-medium ${className}`}
    >
      {/* `text-pretty` on every branch's caption row: a caption that wraps
          keeps company on its last line. The fly-safe label left "diving *"
          alone there, 49px of a 329px column (the pixel probe,
          settings-fly-safe). */}
      <span className="self-end text-pretty">
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
 * **The one checkbox and radio box: 16px, and never squashed.**
 *
 * The platform draws a radio at 13px and a checkbox at 13px or so, and this
 * app sized its checkboxes and not its radios, so a waiver's answer radio
 * stood 13×13 on a page whose checkbox was 16×16 (the pixel probe,
 * waiver-active). `shrink-0` because a flex or grid row shrinks a box beside
 * a label long enough to wrap, and a squashed box is a sliver. The colour is
 * not here: `globals.css` gives every input `accent-color: var(--primary)`,
 * unlayered, so a utility would say it twice and lose.
 *
 * Reach for `ChoiceRow` or `ChoicePill`, which carry this; the bare class is
 * for a box whose row is its own business (a table cell's box, a roster
 * line). `form.test.tsx` refuses a visible box with no size, or wearing the
 * forms plugin's `rounded border-* text-primary focus:ring-*`, which this app
 * does not load and which do nothing to a native box.
 */
export const choiceClass = "size-4 shrink-0";

type ChoiceProps = {
  type: "checkbox" | "radio";
  /** The words, which are the box's accessible name and part of its target. */
  children: ReactNode;
  /** Classes on the row itself: its margin, and its type size where it is not the pill's. */
  className?: string;
} & Omit<ComponentPropsWithRef<"input">, "type" | "className" | "children" | "size">;

/**
 * Where the box sits in both: in a box one line tall and centred
 * (`CHOICE_BOX_LINE`), so it sits on the middle of its words' first line
 * however many lines they wrap to — the reason the row is `items-start` and
 * not `items-center`, which would hang the box beside the middle of a
 * paragraph. The input is written out in each, not in a shared child, so
 * the label visibly holds its control (Biome's `noLabelWithoutControl`
 * cannot see through a component).
 */
const CHOICE_BOX_LINE = "flex h-lh items-center";

/**
 * **A checkbox or radio with its words beside it** — a waiver's agreement, a
 * readiness answer, a publish choice.
 *
 * The label is the whole row, so the words are part of the target, and the
 * row is never under 44px (principles §2): a one-line row centres its line in
 * that height (`content-center`) and a longer one grows. Label rows had no
 * such floor, and the ready page's answers were 20px targets (K-13). Every
 * native input prop passes through to the box, `ref` and `aria-*` included.
 */
export function ChoiceRow({ type, className = "", children, ...input }: ChoiceProps) {
  return (
    <label
      className={`grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] content-center items-start gap-x-3 ${className}`.trim()}
    >
      <span className={CHOICE_BOX_LINE}>
        <input type={type} {...input} className={choiceClass} />
      </span>
      <span>{children}</span>
    </label>
  );
}

/**
 * **A bordered answer pill** — one of a few short answers set side by side
 * or in a grid: Yes / No on the medical questionnaire, a call's outcome, a
 * staffer's roles, the events a hook sends.
 *
 * It was spelled by hand in a dozen places, four ways: `px-3` or `px-4`, a
 * `gap-2` or `gap-3` between box and words, a hover to `bg-surface` (the
 * colour of the card under it, so no hover at all) or to `bg-surface-sunken`
 * or none, and an unsized 13px radio (K-13). This is the one. It paints
 * `bg-surface` so it reads as a control on a sunken form as it does on a
 * card, the way a text box does, and its one hover is the sunken fill.
 *
 * `size="md"` sets the words at 16px, for a diver-facing form whose own copy
 * is 16px (the waiver); the default is a staff form's 14px. The height is
 * 44px either way.
 */
export function ChoicePill({
  type,
  size = "sm",
  className = "",
  children,
  ...input
}: ChoiceProps & { size?: "sm" | "md" }) {
  return (
    <label
      className={`grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] content-center items-start gap-x-2 rounded-lg border border-border bg-surface px-4 py-2 transition-colors hover:bg-surface-sunken ${size === "md" ? "text-base" : "text-sm"} ${className}`.trim()}
    >
      <span className={CHOICE_BOX_LINE}>
        <input type={type} {...input} className={choiceClass} />
      </span>
      <span>{children}</span>
    </label>
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
 * it. A fixed bar would hang over every other page's footer too. It sat at
 * `--dock-clearance` for as long as the staff shell had a phone dock under it;
 * nothing owns the bottom edge now, so it rides the edge itself (ADR
 * 20260919-one-idea, slice 23b).
 *
 * The negative margins let it span the full width of a padded container while
 * its own padding keeps the buttons where the fields are. They are spelled for
 * the one container it sits in: `<main className="… px-4 sm:px-6">` below
 * `lg`, where the bar bleeds to the screen's edges, and from `lg` the editor
 * rail grid's form cell, which has no padding, where the bar is exactly the
 * form's column. It used to bleed `sm:-mx-5` for a `px-5` card nobody put it
 * in: at 1280 its rule ran 408–1147 against a column of 428–1127, 20px into
 * the rail's gutter, and from 640 to 1023 it stopped 4px short of both screen
 * edges (the pixel probe, course-edit and dive-site-edit). A caller in some
 * other container needs its own bleed, not this one.
 *
 * Reach for it when a form is taller than a phone screen with content still
 * to come — a two-field panel wearing one is a bar hovering over nothing.
 *
 * `data-sticky-actions` is what `globals.css` pads the viewport's bottom by
 * (`html:has([data-sticky-actions])`), so a field focus or a fragment jump
 * lands above the bar rather than under it.
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
      data-sticky-actions=""
      className={`sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 ${className}`}
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
 *
 * **The mark centres on the first line.** It sits in a box one line tall
 * (`h-lh`), centred, beside the message at `items-start`. `items-baseline`
 * put it 2px high: an inline SVG's baseline is its own bottom edge, so the
 * glyph stood on the text's baseline instead of on the line's middle (the
 * pixel probe, `trip-guests-refusal-card`: ink 806–819 against caps 810–820).
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
    <>
      <p
        id={id}
        role={noticeRole(tone)}
        className={`flex items-start gap-1.5 text-sm font-medium ${STATUS_TONE[tone]} ${className}`}
      >
        {mark ? (
          <span className="flex h-lh shrink-0 items-center">
            <StatusMark variant={mark} />
          </span>
        ) : null}
        <span>{children}</span>
      </p>
      {/* An outcome that lands below the fold says nothing at all. Every tone
          but `danger`, whose own `FieldErrorFocus` has a better destination —
          see `StatusInView` for why two scrolls in one frame is worse than
          one. */}
      {tone === "danger" ? null : <StatusInView />}
    </>
  );
}

/**
 * A price box in the shop's currency, prefilled from stored minor units. An
 * empty box means unpriced — the one price-entry pattern every form uses, so a
 * shop never sees `type="number"` inputs in one place and free-text decimals
 * in another.
 *
 * Everything currency-dependent here is derived, never assumed: the symbol is
 * the currency's own rather than a literal `$`, the prefill divides by
 * the currency's minor unit rather than 100, and `step` follows the currency's
 * decimal places — a zero-decimal currency like JPY gets whole-number entry,
 * because `step="0.01"` would invite ¥1,234.56, which does not exist.
 *
 * `currency` and `locale` are both required rather than defaulted. A defaulted
 * currency is exactly how a page silently keeps charging dollars after the shop
 * switched (ADR 20260731-shop-currency), and a defaulted locale is the hard-coded
 * formatting `pnpm check:locale` exists to keep out — the caller has the
 * negotiated one in hand either way.
 *
 * **The symbol is in the box, once.** A money box settles to a label that
 * already carries it ("$45"), and an empty one shows it as its placeholder.
 * A prefix beside the box used to print it a second time ("$ $45") and push
 * the box 17px right of its caption, where every other control starts on its
 * own (the pixel probe, settings-payments at 1280).
 */
export function PriceField({
  id,
  name,
  label,
  hint,
  cents,
  currency,
  locale,
  copy,
}: {
  id?: string;
  name: string;
  label: string;
  hint?: string;
  cents: number | null;
  currency: string;
  locale: string;
  /** Words for the reading line under the box (`forgivingCopy`). */
  copy: ForgivingCopy;
}) {
  // "95", "$95" and "95.00" are one figure (ADR 20260906-before-you-ask,
  // decision 3): the box takes what a person types and settles to the scanned
  // form, and the hidden control submits the major-unit figure the old number
  // input sent, so the server sees no difference.
  return (
    <Field label={label} hint={hint}>
      <ForgivingInput
        kind="money"
        id={id}
        name={name}
        locale={locale}
        currency={currency}
        copy={copy}
        defaultValue={cents === null ? "" : String(minorToMajor(cents, currency))}
        placeholder={currencySymbol(currency, locale)}
      />
    </Field>
  );
}
