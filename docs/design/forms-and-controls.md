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

## Saying what happened: `Field error` + `FormStatus`

**A form's answer belongs where the form is.** Not under the `<h1>`, not in a banner the length of
the page away from the button that earned it. The rule has three steps, in order of preference:

1. **Field-level** — the refusal names one box, so it renders on that box. Pass `Field`'s `error`
   prop; it renders the message under the control in a `role="alert"` region and wires the control's
   own `aria-invalid` and `aria-describedby` automatically. Never hand-roll that triple.
2. **Form-level** — the refusal (or the confirmation) is about the submission as a whole, so it
   renders in the form's action row, beside the submit control. Use `FormStatus`, which follows the
   shared tone→role rule (`noticeRole`): a refusal is an `alert`, a confirmation is a `status`.
3. **Page-level** — only for what is genuinely about the page rather than one form on it. A
   permission refusal that bounced someone here from elsewhere is the honest example; "your save
   worked" is not.

```tsx
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";

<FieldGrid as="form" action={createPromoAction} columns={2}>
  <Field label={t("promos.fields.code")} error={codeRefusal}>
    <input name="code" required className={controlClass} />
  </Field>
  <FieldActions>
    <SubmitButton pendingLabel={t("promos.creating")} className={buttonClass()}>
      {t("promos.createCode")}
    </SubmitButton>
    <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
  </FieldActions>
</FieldGrid>
```

Both render nothing when there is no message, so a form's resting layout is unchanged.

### Routing a `?notice=` to the right form

Most staff surfaces answer a save by redirecting back with a `?notice=` code. On a page with more
than one form, the code alone does not say which form it answers, and a generic code (`invalid`) is
emitted by several. Two pieces close that:

- Each entry in a page's notice map carries a `form` name alongside its tone and message key.
- An action whose code is ambiguous appends `&form=<name>` so it lands home anyway. The reader
  validates that param against the page's own set of form names — a query string is
  attacker-supplied, and an unknown name must fall back to the code's default home rather than
  vanish into a section nothing renders.

The page resolves the notice once, hands each form its own with `noticeForForm`
(`src/lib/staff-notices.ts`), and keeps whatever is left for the page banner — including anything
homed to a section this staffer's role means the page never rendered. Worked examples: the trip
Overview and Guests tabs (`resolveTripNotice`), and Settings, which got there first with its own
`?saved=<section>` (`SettingsPage.tsx`'s `SectionNotice`).

### Moving the cursor to the refusal

Saying it is half of it; a keyboard or screen-reader user still has to *find* the box.
`FieldErrorFocus` (`src/components/ui/FieldErrorFocus.tsx`) scrolls the offending control into
view, focuses it, and rings it briefly. Given no `field` it takes the first
`[aria-invalid="true"]` inside its `scope`, which is exactly what `Field`'s `error` marks — so a
surface that renders per-field errors gets the focus move for free. `key` it on the submission
(the notice code, an attempt counter) when the same refusal can happen twice in a row.

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

<Link href={href} className={buttonClass({ variant: "secondary", size: "sm" })}>Create order</Link>
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

### Settings hubs are the one place "several sections, several primaries" doesn't apply

The "several independent sections can have several primaries" carve-out above fits a page built
from two or three genuinely separate workflows — a trip page's roster tab beside its prep tab, say.
It does not fit a **settings hub**: a page whose only job is to list many independent, fully
reversible preference forms, with no section more urgent than any other (`SettingsPage.tsx` is the
one today — nine "Save" forms from timezone to rental pricing, each behind its row's summary-first
disclosure, so at most a few are ever open at once — and the rule still holds for the ones that
are). Nine
solid teal buttons down one scroll don't read as nine calm, equally-available options; they read as
nine simultaneous demands, which fights principle #3 ("calm surfaces, earned moments of joy") on a
page that is, by design, the least urgent place in the app. Every "Save" on a settings hub demotes
to `secondary` — still a real, focusable, submitting button, just without the shout. A control that
*is* the one thing a shop is on the page to do — Settings' own Stripe "Connect a payment account"
CTA when none exists yet — keeps full primary weight, the same way Team's own "Send invite" does on
its separate page: the rule narrows what counts as "the page's action," it doesn't remove the
concept.

## Menus

Dropdown panels are one column, one item per row, `whitespace-nowrap`. A multi-column menu wraps
short labels onto two lines and strands the odd item of an odd-length group in a column of its own,
which reads as a layout bug rather than a menu. See `src/components/ShopNavLinks.tsx`.
