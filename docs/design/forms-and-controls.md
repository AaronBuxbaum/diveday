# Forms and controls

Two alignment bugs kept coming back, because both are invisible in a diff and obvious on screen.
Both are now solved in one place. **Use the wrappers — don't hand-roll the class strings.** If a
surface looks wrong, the fix belongs in the wrapper, not at the call site.

## Cards: `SectionCard`

The bordered panel a staff page is mostly made of. It had no component until 2026-08-15, so every
page retyped it — **209 times across 153 files**, at four radii (`rounded-2xl`, `rounded-lg`,
`rounded-xl`, `rounded-3xl`) and six paddings, with `shadow-sm` on only 26 of them. Sibling settings
routes one tap apart rendered the same panel at two different corner radii, and identically-shaped
cards sat at two elevations on one page.

One spelling now, and it is the one `ShopStat` and the `<Table>` shell already shared —
`rounded-2xl border border-border bg-surface shadow-sm` — so **a card, a stat tile and a table
shell read as the same object**.

```tsx
import { SectionCard } from "@/components/ui/card";

<SectionCard
  padding="lg"
  title={t("backup.form.heading")}
  description={t("backup.form.description")}
  actions={<Badge tone="success">{t("backup.status.verified")}</Badge>}
>
  <FieldGrid as="form" action={saveBackupDestinationAction} columns={2}>…</FieldGrid>
</SectionCard>
```

- **There is no `radius` prop, and there will not be one.** A prop that lets every call site keep
  the radius it happens to have today preserves the drift behind an abstraction and calls it a
  design system. A card that looks wrong is fixed in the component — the same rule `buttonClass()`
  and `SegmentedControl` keep.
- **`padding`** is `md` (`p-4 sm:p-5`, the default and the `ShopStat`/`Table` spelling), `lg`
  (`p-5 sm:p-6`) for a card someone works *inside* — a form, a wizard step, a set of snippets — or
  `none` for a card that is a **shell**: a divided row list, a `<details>`, anything whose own parts
  pad themselves.
- **`elevated`** follows containment, the rule `Table`'s `flush` and `ShopStat`'s `inset` already
  keep: a card on the page is raised; a card that has to sit inside another one drops its shadow so
  surface never stacks on surface.
- **The heading is folded in.** Pass `title`; never spell `<h2 className="text-lg font-semibold">`
  at a call site. `titleAs="h3"` steps a card down one level when it sits under a group that
  already owns the `h2` (the export page's Backups half) — the element *and* its size, so a group
  and the five cards under it never shout at the same volume.
- **`description` and `actions`** are the rest of the header row: one quiet line under the heading,
  and whatever belongs to its right (a `Badge`, the section's buttons), wrapping below it on a
  phone. The card owns the gap between that header and the body, so **a call site never opens its
  body with `mt-4`** — which is how four spacings for one relationship got into the settings routes.
- **`as`** is the element the card *is*: `section` by default, `li` for a person on a roster,
  `details` for a disclosure, `div` for a shell.

### Section rhythm: `space-y-10`, never `mt-*`

`SectionCard` carries **no outer margin at all**. A page stacks its sections in one `space-y-10`
on the wrapper. Hanging a margin off each section is how `<section className="mt-N">` grew nine
different values across the app (`mt-10` ×23, `mt-6` ×17, `mt-8` ×14, `mt-12` ×9, and one or two
each of `mt-7`, `mt-3`, `mt-9`, `mt-5`, `mt-4`) — nobody chose those; each was copied from
whichever neighbour was open at the time.

Two things are deliberately *not* on that rhythm:

- **A list of like cards** — two calendar feeds, a roster of eleven people — keeps its own tighter
  gap (`gap-3`/`gap-4`). That is a list, not a run of sections.
- **A stack of cards inside one section** — the five Backups panels under their group heading —
  uses `space-y-6`, so the group still reads as their parent.

### A route's `loading.tsx` takes the shell from the same place

A skeleton narrower, squarer or flatter than what replaces it is a layout jump on every navigation
into the route. `sectionCardClass({ padding, elevated, className })` is the card's chrome as a
class string, for exactly that — the skeleton and the page can no longer drift apart.

```tsx
import { sectionCardClass } from "@/components/ui/card";

<div className="mt-8 space-y-10">
  <div className={sectionCardClass({ padding: "none", className: "h-44" })} />
  <div className={sectionCardClass({ padding: "none", className: "h-40" })} />
</div>
```

**Where this has landed so far:** 88 files, converted cluster by cluster on 2026-08-15 — all of
`src/app/shop/[shopSlug]/settings/**`, then `trips/**`, `divers/**`, `orders/**`, the shared
`src/components/**`, the diver-facing `src/app/s/[shopSlug]/**`, the bearer-token pages,
`dive-sites/**`, and the marketing routes.

About 85 files still carry a hand-typed `border border-border bg-surface` — but that count is no
longer a to-do list, and reading it as one is the mistake to avoid. Each cluster's pass sorted the
remainder into things that are genuinely **not** section cards, and left the reason at the site:
sunken insets (`bg-surface-sunken`), overlays carrying `shadow-lg`/`shadow-2xl`, tone-carrying
panels, `<fieldset>`s whose `<legend>` is a control's accessible name, and the marketing pages'
`bg-background` cards, which are that colour precisely because the band behind them is
`bg-surface`. See the "What is *not* a section card" section of
[`src/components/ui/card.tsx`](../../src/components/ui/card.tsx), which records the three widening
props that were asked for and refused.

New code uses `SectionCard` from the start; a migrated route never goes back.

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

### Which tone token: `text-success` or `text-success-strong`

Settled by measurement, so nobody has to re-derive it. Ratios computed from the token values in
`src/app/globals.css`, sRGB compositing for the `/10` fills, WCAG 2.x relative luminance. AA for
normal text is **4.5:1**, and contrast is size-independent — a 12px badge and a 16px paragraph face
the same bar, because none of this is "large text" (18pt / 14pt bold).

The `-strong` tokens are `color-mix(in srgb, black 6%, var(--success|--warning))`.

**Light palette** (`--surface` `#ffffff`, `--background` `#faf9f6`, `--surface-sunken` `#f1efe9`):

| text | on `bg-surface` | on `bg-surface` + own `/10` fill | on `bg-surface-sunken` | on sunken + own `/10` fill |
| --- | --- | --- | --- | --- |
| `text-success` | 5.02 | **4.39** | **4.36** | **3.84** |
| `text-success-strong` | 5.54 | 4.84 | 4.82 | **4.24** |
| `text-warning` | 5.02 | **4.38** | **4.37** | **3.84** |
| `text-warning-strong` | 5.55 | 4.84 | 4.82 | **4.24** |
| `text-danger` | 6.47 | 5.46 | 5.63 | 4.78 |

**Dark palette** (`--surface` `#0d222d`, `--surface-sunken` `#051118`):

| text | on `bg-surface` | on `bg-surface` + own `/10` fill | on `bg-surface-sunken` | on sunken + own `/10` fill |
| --- | --- | --- | --- | --- |
| `text-success` | 9.39 | 7.60 | 10.96 | 9.20 |
| `text-success-strong` | 8.27 | 6.70 | 9.65 | 8.11 |
| `text-warning` | 9.80 | 8.04 | 11.44 | 9.66 |
| `text-warning-strong` | 8.63 | 7.08 | 10.07 | 8.51 |
| `text-danger` | 5.91 | 5.21 | 6.90 | 6.18 |

Bold is under AA. Read off it:

- **Light is the binding scheme.** Every dark-palette combination clears AA by a wide margin.
  Mixing black into an already-light-on-dark hue *lowers* contrast, so `-strong` is a light-mode fix
  that costs a little in dark and never rescues anything there. It is still safe everywhere, which
  is why one token can serve both schemes.
- **On a tinted fill of its own hue, success/warning text is `-strong`.** The raw hue lands at
  4.38–4.39, just under. `danger` needs no `-strong` and has none.
- **On `bg-surface-sunken`, success/warning text is `-strong`** even with no tint (4.36 → 4.82).
  This is why `StatTile`'s figure uses `-strong`: the tile's `inset` variant is a sunken box.
- **On plain `bg-surface`, the raw hue is fine** (5.02) — which is what `KindChip` relies on, and
  why it names `bg-surface` on the chip itself rather than inheriting whatever it landed in.
- **A tinted status fill does not go inside a sunken panel.** That is the one combination `-strong`
  does not save (4.24). If a tinted pill has to live in a sunken container, drop the tint and give
  it a border instead, the way `KindChip` does.
- **Boat mode is exempt from all of it.** `.boat-mode` retunes the feedback hues for a deck in
  sun; its worst tinted-fill combination measures 5.40:1 in light and 5.32:1 in dark, so the
  roll-call fills that use the raw token there are compliant and stay as they are.

`FormStatus` uses `-strong` unconditionally for those two tones. It is mounted in whatever container
its form is in — a card footer, a disclosed settings row, a sunken inset panel — and it is the
component that tells a staffer a save was refused, so it does not get to be the one that guessed.

### The tone marks (✅ ⚠️ ❌)

One declaration, `src/components/ui/tone.ts`, shared by `Badge`, `FormStatus`, and `ShopNotice`.
Only the three pass/fail/caution tones get a mark; `primary`/`neutral` are counts and labels, so
`toneGlyph()` returns `undefined` for them and a caller cannot mark a count. They are **emoji, not
text dingbats** (`✓ ▲ ✕`) — a text codepoint takes the surrounding font and colour and reads at
badge size as a font falling back rather than as a status, which was reported from the field. Don't
tidy them back. The strings carry no trailing space; the gap belongs to the consumer's layout.

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

**A `link` that must line up with the prose above it passes `flush: true`, never `className:
"px-0"`.** Two utilities for one property resolve by **stylesheet** order, not by the order you
wrote them in the attribute, and Tailwind emits `px-0` before the size's `px-4` — so the size wins
and the label renders indented, while the `px-0` in the source reads as though someone already
fixed it. Three links on `/pricing` and two on the homepage sat 16 measured pixels inside the text
above them that way. `flush` drops the size's horizontal padding at every breakpoint and keeps
`min-h-11` and the vertical padding, so the touch target survives.

```tsx
// Wrong: the size's px-4 wins, the label renders indented
<Link className={buttonClass({ variant: "link", className: "px-0" })}>See the full list →</Link>

// Right
<Link className={buttonClass({ variant: "link", flush: true })}>See the full list →</Link>
```

The same trap applies to the type scale, which is why it lives on the sizes: a `text-base` passed
through `className` cannot reliably beat a size's `text-sm`. Pick the size that already says it.

**Anything else that sets a `min-h-*` floor** — a `<summary>`, a nav chip, a wrapper — still has to
center its own content: give it `flex items-center` or `inline-flex items-center`. A height floor
without centering is the bug.

## Segmented choices: `SegmentedControl`

A small set of sibling **destinations** — the trip page's tabs, the waiver surface's two tabs, the
manifest's checkpoint row, the Today queue's urgency/departures switch — renders as one grammar: a
sunken track with a raised pill on the current choice. Four surfaces hand-rolled that shape and had
already drifted apart (a fourth `rounded-full` variant, three subtly different class strings), so
it is now one component, `src/components/ui/SegmentedControl.tsx`. **Segmented track-and-pill class
strings are never written at a call site** — the same rule as `buttonClass()`: if a segmented
control looks wrong, fix the component.

```tsx
import { SegmentedControl } from "@/components/ui/SegmentedControl";

<SegmentedControl
  ariaLabel={copy.ariaLabel}
  items={[
    { key: "template", label: copy.template, href: root },
    { key: "signatures", label: copy.signatures, href: `${root}/signatures` },
  ]}
  currentKey={current}
  fill
/>
```

- **Every option is a real URL.** The wrapper is a `<nav>` of `<Link>`s, so an option opens in a new
  tab, bookmarks, and works before JavaScript. A choice that only exists in client state is not a
  segmented control — it is a form control, and belongs in a `Field`.
- **`fill`** makes the options equal-width across the container (a tab bar under a page header);
  leave it off for a content-width track that sits beside other things in a row.
- **`size="boat"`** raises the target floor to 56px with 16px labels, for surfaces worked at the
  rail with wet hands and glare (the manifest's checkpoint row). Everything else takes the default
  44px.
- **The current item is inert by default** — a `<span>` with `aria-current="page"`, because a tab
  bar's "you are here" is not a destination. A control whose options are views of the *same* page
  (`?view=`, `?checkpoint=`) passes `currentIsLink` (a re-tap is a harmless reload),
  `ariaCurrentValue="true"`, and `scroll={false}` so switching views holds the reader's place.
- Labels arrive resolved: staff copy is server-side only, so each call site translates its own
  options and passes words.

**Not for same-page anchors.** A row that jumps to sections of the page you are already on is
`src/components/JumpNav.tsx` — link-buttons under a hairline rule — and it stays visually distinct
on purpose. A segmented track marks one option current; a jump row can never mark anything current,
because every entry is on this screen. Two controls that look identical and mean different things
is the exact drift both components exist to end, so never dress a jump row as a track, or a tab bar
as a row of links.

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
