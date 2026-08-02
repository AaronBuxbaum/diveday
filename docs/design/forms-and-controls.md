# Forms and controls

Two alignment bugs kept coming back, because both are invisible in a diff and obvious on screen.
Both are now solved in one place. **Use the wrappers — don't hand-roll the class strings.** If a
surface looks wrong, the fix belongs in the wrapper, not at the call site.

## Fields: `FieldGrid` + `Field`

Multi-column forms used to give every field its own `flex flex-col` stack. That looks fine until a
caption wraps — "Email (optional)" going to two lines pushed its input a line lower than its
neighbours', and the row stepped down the page.

`FieldGrid` declares **two rows per field row** (captions, then controls) and `Field` subgrids onto
them, so controls line up regardless of how captions wrap.

```tsx
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";

<FieldGrid columns={3} as="form" action={addDiverAction}>
  <Field label="Full name">
    <input name="fullName" required className={controlClass} />
  </Field>
  <Field label="Email" hint="(optional)">
    <input name="email" type="email" className={controlClass} />
  </Field>
  <FieldActions>
    <button type="submit" className={buttonClass()}>Add diver</button>
  </FieldActions>
</FieldGrid>
```

- **A stacked field is a `Field`.** Writing `<label className="flex flex-col">` by hand re-creates
  the bug this component exists to prevent.
- The caption goes through `label`/`hint`, never as children — that is what keeps the two-row shape.
- `hint` is a short inline qualifier ("(optional)"). `description` is longer helper text and renders
  under the control, referenced via `aria-describedby` rather than folded into the control's
  accessible name (below).
- `columns` is 1–4; per-field spans and widths go on `<Field className>`.
- **Every direct child of a `FieldGrid` spans two rows.** A `Field` does that for you; anything else
  you drop in — a spacer that skips a column, say — has to say so itself (`sm:row-span-2`), or it
  knocks each later field half a row out of step and the grid renders as a staircase.
- A control keeps its own height. The control row is one subgrid track shared across the row, so it
  is as tall as the longest neighbouring field's `description`; `Field` pins the control to the top
  of that track (`content-start`) so a 44px input never renders as a 52px box beside its sibling.
- `FieldActions` spans every column, so the submit button never becomes a lopsided extra field.
- Horizontal checkbox/radio rows are not stacked fields — leave them as plain labels.

### Required fields

**Convention: every field is required unless the caption carries `hint="(optional)"`.** Add
`required` to the control itself (the native attribute, not a `Field` prop) — `Field` detects it
and renders a visible `*` next to the label automatically, for every field in the app, with no
per-call-site change needed. The marker is decorative (`aria-hidden`); a screen reader announces
"required" from the control's own native `required` attribute, which is why the attribute has to
be real and not just a visual convention.

```tsx
<Field label={t("party.emailLabel")}>
  <input name="email" type="email" required className={controlClass} />
</Field>
<Field label={t("party.phoneLabel")} hint={t("party.phoneHint" /* "(optional)" */)}>
  <input name="phone" type="tel" className={controlClass} />
</Field>
```

### `aria-describedby` and control association

`Field` clones the single control it's given (the documented `children` contract: pass the
control itself) to wire two things automatically, so hand-rolled `htmlFor`/`id`/`aria-describedby`
plumbing at the call site is no longer needed for the common case:

- **Association.** The caption `<label>` wraps only itself and points at the control via
  `htmlFor`/`id` — pass `htmlFor` when the control already has a stable `id` of its own (or let
  `Field` mint one with `useId()`).
- **Description.** `description` gets its own id, referenced from the control's
  `aria-describedby` (merged with anything the caller already set — a per-field error id from
  `BookingPartyFields`/`ImageFileInput`'s pattern keeps working the same way).

This only applies when `children` is a single control element (`<input>`/`<select>`/`<textarea>`)
— the documented contract. A `Field` wrapping something else (rare) falls back to the original
label-wraps-everything shape.

### Lint note: icon-only controls

An icon-only `<button>`/`<a>` (a chevron, an `×`, the `?` shortcuts trigger) has no text content
for a screen reader to read — it needs an explicit `aria-label`, sourced from the message bundles
like any other copy. `biome`/`check:copy` cannot catch a *missing* `aria-label`, only a
hard-coded one, so this is a manual review point: if a control's only visible content is an icon,
glyph, or `aria-hidden` SVG, it must carry `aria-label` (or, for a toggle whose pressed state
matters, `aria-pressed` too).

## Buttons: `buttonClass()`

Every touch target sets a `min-h-11` floor for the dock test (principle 2). A box with a height
floor that is not `flex`/`inline-flex`/`grid` leaves its label sitting at the top of the taller box
instead of centered in it — most visible on button-shaped `<Link>`s, which are inline by default.

`buttonClass()` is `inline-flex items-center justify-center` in every variant, so centering is
structural rather than remembered.

```tsx
import { buttonClass } from "@/components/ui/button";

<Link href={href} className={buttonClass({ variant: "secondary", size: "sm" })}>Create invoice</Link>
<button type="submit" className={buttonClass({ variant: "danger" })}>Refund</button>
```

Variants: `primary`, `secondary`, `ghost`, `danger`, `danger-solid`, and `link` (reads as inline
text but still claims a full target). Sizes: `sm`, `md`, `lg`. Pass one-off adjustments through
`className`; do not rebuild the base. If you find yourself cancelling a variant's own styles, the
variant is wrong — add one.

**Anything else that sets a `min-h-*` floor** — a `<summary>`, a nav chip, a wrapper — still has to
center its own content: give it `flex items-center` or `inline-flex items-center`. A height floor
without centering is the bug.

## Action rows: one primary, not many

Principle 8 ([principles.md](principles.md)) says a screen gets one obvious next action **per
section** — a page with several independent sections can have several primaries, one apiece. That
means one primary-weight control *rendered at a time* (no explicit `variant`, an explicit
`variant: "primary"`, or `variant: "danger-solid"`) per section — count what's actually on screen
together, not `buttonClass()` call sites: a ternary that renders one button or the other
depending on state isn't two primaries, and a single call site mapped over a list can render many.
Everything else in the same row demotes to `secondary`, `ghost`, `link`, or, for a destructive
option that isn't the section's main action, `danger`.
`danger-solid` is reserved for when the destructive action *is* the section's sole primary (e.g. a
standalone "Refund" section) — don't use it to demote a non-primary destructive action, and don't
strip a destructive action's danger styling just to satisfy "one primary."

```tsx
// Before: three equal-weight buttons, the user has to triage
<button className={buttonClass()}>Save</button>
<button className={buttonClass()}>Save & send</button>
<button className={buttonClass()}>Save & archive</button>

// After: one primary with a good default, the others demoted — not deleted
<button className={buttonClass()}>Save & send</button>
<button className={buttonClass({ variant: "ghost", size: "sm" })}>Save without sending</button>
<button className={buttonClass({ variant: "link", size: "sm" })}>Archive instead</button>

// A destructive action alongside a normal one keeps its warning color, demoted in weight, not
// stripped of it
<button className={buttonClass()}>Save changes</button>
<button className={buttonClass({ variant: "danger", size: "sm" })}>Delete diver</button>
```

Reach for demotion first — variant alone often turns three equal-weight buttons into one obvious
action and two-or-three quiet ones. Reach for a merge (fold two button labels into one action with
a default) when the buttons are really the same action with a variant nobody needed to choose up
front. A rare or advanced action that can't merge or demote without disappearing entirely belongs
behind disclosure (a "More" affordance, a details expander) rather than sitting inline at primary
weight.

## Menus

Dropdown panels are one column, one item per row, `whitespace-nowrap`. A multi-column menu wraps
short labels onto two lines and strands the odd item of an odd-length group in a column of its own,
which reads as a layout bug rather than a menu. See `src/components/ShopNavLinks.tsx`.
