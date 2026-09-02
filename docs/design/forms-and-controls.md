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
`rounded-panel border border-border bg-surface shadow-bed` (Reef's 28px panel on the warm bed, ADR
20260901-diveday-reimagined 13a) — so **a card, a stat tile and a table shell read as
the same object**. That spelling lost its shadow on 2026-08-28 (ADR
20260827-clearwater-surface-language, decision 1: **elevation is earned**) — a panel at rest is a
fill and a hairline, and a shadow says the thing *floats above the page*, which is true of a menu,
a sheet, a dialog and a toast and of nothing else.

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
- **There is no `elevated` prop either.** It existed so a card nested inside another card could
  stop stacking surface on surface; with no shadow at rest there is nothing left to stack, and an
  option that can only ever be a no-op is a call site asking for an elevation it will never get.
  `Table`'s `flush` and `ShopStat`'s `inset` still follow containment — they drop the *border and
  fill*, which is a different question.
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

### Where a heading goes

Inside the card it names, above the group it governs. The test is one question, asked of whatever
sits directly under the heading:

> **Would this heading still be telling the truth if the card under it disappeared, multiplied, or
> swapped for an `EmptyState`?**

If the heading and the card live and die together, the heading is the card's — pass it as `title`.
If the heading would survive — because the body is a list that grows, a stack of sibling cards, or
a section whose body swaps to an empty state — the heading stands above, bare, and everything under
it names itself.

- **One card, one subject → the heading is the card's `title`.** The card *is* the section, so
  `SectionCard` renders the `h2` and derives its `aria-labelledby` from it. A bare heading floated
  above a single card splits one object into two: the named region and the visible border disagree,
  so a screen reader lands on an unnamed panel while the heading sits ownerless in the gutter. The
  staff waivers page and the diver record's "Book an activity" both read that way until 2026-08-21.
- **A plural body → the heading stands above, and the members name themselves.** "Plural" means a
  stack of sibling cards, a grid of object cards, one `padding="none"` shell of divided rows, or a
  body that renders `EmptyState` when it is empty. The group heading is a bare `<h2
  className="text-lg font-semibold">` — the **same scale** as a card's own `h2`, because a section
  speaks at one volume whether its heading sits inside one card or above five — and each card under
  it steps down with `titleAs="h3"`, or carries the object's own name when the card *is* a thing.
  The heading has to live above precisely because the body is unreliable: close-out's "Tomorrow"
  heading must survive its card swapping to an `EmptyState`, and a heading inside that card would
  vanish at the moment the section most needs to say "nothing waiting".
- **A collapsable's heading is its `<summary>`. Never a bare heading above a `<details>`.** A closed
  disclosure under a floated heading is a heading over apparently nothing — and worse, the heading
  is the tap-sized text a reader will press, and it opens nothing. The summary is the heading *and*
  the control, at the level the card would have had: `h2` when the disclosure is a page section,
  `h3` when it sits inside a group's shell. A *group* of collapsables takes a group heading above,
  like any other group. A disclosure *inside* a titled card (an "Edit" toggle) is not a heading at
  all — it is a control label, and it stays out of the heading hierarchy.
- **A band takes no heading.** A search or filter form wearing the card's chrome acts on the content
  below it rather than containing content of its own; its field labels are its words. Giving a band
  a title manufactures a section where there is only a control.

**One card, or a group?** When a section could be built either way, the line is ownership of state.
Parts only true *together* — a progress figure over its own rows, a map above the address it locates
— are one card with internal structure. Members that can be added, removed, or linked to on their
own are a group under one heading. **A group of one is still a group if it can grow.**

**The hand-spelled anatomies place by this grammar too.** The marketing exemption above is a
*type-scale* exemption, not a placement one, and the marketing pages already prove it: `/product`'s
mid-CTA heading sits **inside** its card, hand-spelled under 36px display type where `text-lg` would
turn the page's one checkable proof into fine print. The same goes for a tone-carrying panel, a
full-bleed shell, and an eyebrow — each hand-spells its heading for a reason stated at the site, and
each still *places* it by this grammar. So does a card that is a `<form>`: `SectionCard`'s element
set excludes `<form>`, so such a card cannot take a `title` at all, and its heading is hand-spelled
at the `h2` scale as the card's first child (`BookActivity` on the diver record) rather than floated
above it.

**A tone does not change a heading's volume.** A warning, success or primary-tinted panel spells its
`h2` at the same `text-lg font-semibold` as an untoned one, keeping whatever tone colour it carries:
scale carries hierarchy, colour carries state. A heading that grew or shrank because something went
wrong would move the page's apparent structure as panels change state, and a reader would re-learn
the hierarchy every time — so a tone-carrying panel's heading is never quieter for having a tone,
and never louder for it either.

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
into the route. `sectionCardClass({ padding, className })` is the card's chrome as a
class string, for exactly that — the skeleton and the page can no longer drift apart.

```tsx
import { sectionCardClass } from "@/components/ui/card";

<div className="mt-8 space-y-10">
  <div className={sectionCardClass({ padding: "none", className: "h-44" })} />
  <div className={sectionCardClass({ padding: "none", className: "h-40" })} />
</div>
```

**Where this has landed so far:** 120 files, converted cluster by cluster on 2026-08-15 and
2026-08-16 — all of `src/app/shop/[shopSlug]/settings/**`, `trips/**`, `divers/**`, `orders/**`,
the shared `src/components/**`, the diver-facing `src/app/s/[shopSlug]/**`, the bearer-token pages,
`dive-sites/**`, the marketing routes, and the staff Today, check-in, bookings, waivers, schedule,
courses, close-out, promos, reports, reviews, requests, and staffing surfaces (including their
loading shells).

The remaining hand-typed `border border-border bg-surface` rectangles are not a to-do list, and
reading them as one is the mistake to avoid. Each cluster's pass sorted the remainder into things
that are genuinely **not** section cards, and left the reason at the site:
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

### `hint` or `description`: where the words go, not how long they are

Both take a `ReactNode` and both read as "the helper text", which is how a **31-word** sentence
ended up in `hint` on the sign-up form — pushing that caption to five lines, leaving a ~100px hole
beside it in the two-column grid, floating the required `*` at the end of a paragraph, and folding
the whole thing into the control's accessible name (issue #784).

The line is not length, it is **where it renders**:

- **`hint`** renders *inside* the `<label>*, on the caption row. A `<label>`'s text content is the
  control's accessible name, so a screen reader reads a hint **every time the field is announced**.
  That is right for `(optional)` and wrong for a sentence.
- **`description`** renders under the control, gets its own id, and is referenced from
  `aria-describedby` — read once, as a description, and free to be as long as it needs to be.

`src/components/ui/form.test.tsx` holds `hint` to a 15-word ceiling by scanning every
`hint={t("…")}` in the app and resolving it against the bundles. The bound is generous on purpose:
it is not a style rule about brevity, it is the point past which the other prop is the right one.

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
label-wraps-everything shape, **unless the caller passes `htmlFor`**, which says the control is
already named and leaves the caption a plain sibling. Pass it whenever the child renders a
`<label>` of its own: nested labels are invalid HTML, and a click in the overlap has two controls
to forward to.

### Picking a file: `ImageFileInput`

A bare `<input type="file">` paints the operating system's grey "Choose Files / No file chosen" —
in the *device's* language, whatever the reader's is. Every photo picker in the app goes through
`src/components/ImageFileInput.tsx` instead, and the CSV picker in `ImportWizard` is the same
shape by hand:

- the input is `sr-only` **inside** a `<label>` wearing `buttonClass()`, so what looks like a
  button *is* the label — one control, one tap target, one focus stop (the ring is drawn with
  `focus-within`);
- `sr-only` and never `hidden`: a `display:none` control carrying `required` makes Chrome refuse
  the whole submit as "not focusable" instead of reporting the field;
- what was picked is named beside it, and the button switches to its `chooseAnother` word;
- there is **no `className` escape hatch** — a prop letting each call site keep the appearance it
  happens to have preserves the drift behind an abstraction, the same reason `SectionCard` has no
  `radius`.

### A form taller than a screen: `StickyFormActions`

`FieldActions` is the submit row for a form you can see all of. For the ones you cannot, use
`StickyFormActions` — the same row, `sticky bottom-0`, riding the bottom edge while the form is on
screen and settling into place at the end of it.

The course editor is why it exists: nine sections, **4,002 px** at desktop width, and one "Save
course page" at the very bottom, so fixing a typo in the subhead at y≈300 meant scrolling 3,700 px
to commit it (issue #815). `sticky`, not `fixed`, because the bar belongs to the form rather than
to the window.

Reach for it when a form is taller than a phone screen with content still below the fold. A
two-field panel wearing one is a bar hovering over nothing.

**Say what the form is holding, not what it did.** "Unsaved changes" beside the button is a state
the surface cannot show on its own; a confirmation that the save worked belongs in `FormStatus` or
the control's own face (see the ephemeral-acknowledgement section below).

**A sticky bar needs its own visual capture.** Chromium's full-page screenshot stitches the document
at scroll 0 and does not paint a *currently stuck* element at all — measured on the course editor,
where `Save course page` reports a bounding box at y=744 and the 8,531 px capture contains no pixel
of it anywhere. So a surface that adopts `StickyFormActions` also takes a `captureStickyFoot`
capture in `e2e/visual.spec.ts` (it scrolls to the foot first, where the sticky offset is zero and
the element paints normally). Without it the page's primary action has no baseline, which is the
opposite of what a capture is for.

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

### A tap never sends the page back to the top

A same-page action — a form submit, a server action, a resend — never scrolls the reader back to
the top of a long page and never falls back to a full browser navigation/reload. Both read as the
same bug from the reader's chair: they tapped a button two screens down and lost their place.

`PreserveFormScroll` (`src/components/PreserveFormScroll.tsx`, mounted once in the root layout) is
the fix, and it really is global — every route gets it for free, with nothing to add at a new
layout. It remembers `window.scrollY` on every real `<form>` `submit` event and restores it once
the server action's `revalidatePath`/redirect lands back on the same pathname. A form that posts
through this pattern gets scroll preservation for free — nothing to add at the call site. What
still breaks it:

- **A client-side navigation instead of a same-page action.** `router.push`/`router.replace` (and
  `<Link>`, which uses the same mechanism) default to `scroll: true` — a genuine route change, so
  scrolling to the top is often *right*, but a control that merely wants to refresh data or swap a
  view on the page it's already on must pass `scroll: false` (`SegmentedControl`'s `?view=`/
  `?checkpoint=` options are the worked example) or, if it's really a form outcome, go through a
  server action instead so `PreserveFormScroll` covers it.
- **A control that isn't a real `<form>` submit.** `PreserveFormScroll` listens for the `submit`
  DOM event; a button wired to a plain `onClick` that calls a server action directly (rather than
  as a `<form action={...}>`'s submit) never fires that event and is invisible to it.
- **A JS-disabled or pre-hydration fallback that posts natively.** A real HTML form submission is a
  full navigation and always lands at the top — the reason every mutating control here is a real
  `<form>`, so the no-JS path still works, but also why it must actually be one, not a `<button
  onClick>` standing in for it.

A control that must deliberately jump — following a `#fragment` link into a fresh `<details>`, an
explicit "jump to" control — sets `form.dataset.scrollReset = "true"` (`RoleOrientationCard`,
`ShopIdentityMenu`) to opt that one submit out, or is simply not a form at all. Everything else
inherits the preservation; the anti-pattern to watch for in review is a *new* client-side
navigation call standing in for what should have been a server action or an in-place `router.replace(
..., { scroll: false })`.

### Ephemeral acknowledgement: a control's own face first, `Toast` second

Three ways to say what a tap did, cheapest first:

1. **The control's own face.** A ring, a mark, a swapped label (`Copyable`'s button text becoming
   "Copied") — anything already on screen that visibly changes. If the control can carry its own
   outcome, nothing else should say it too; the diver record's three waiver-delivery buttons wear
   a ring and a mark for exactly this reason; a bordered box repeating "sent"/"failed" underneath
   them was a caption on a photograph of itself (copy-restraint).
2. **`Toast`** (`src/components/Toast.tsx`) — a brief, auto-dismissing line for an action that
   leaves no other trace: a clipboard write is the case it exists for. Not for anything reversible
   or that offers a next step (that's `UndoToast`), and never a substitute for state a control
   already shows on its own face — reach for it only once you've confirmed step 1 has nothing to
   say.
3. **`FormStatus`**, inline beside the form — for an outcome nothing else on screen carries: a
   genuine refusal, a batch result naming several people. This is still "beside the form, never a
   banner the length of the page away" from the section above; the difference from `Toast` is
   permanence — `FormStatus` sits in the form's resting layout and reappears on every render of
   that state, where `Toast` fires once and is gone.

Never reach for a box or a banner to restate what a fresh row, a badge, or a ring elsewhere on the
page already shows the instant the action lands — see copy-restraint's deletion #1 for the general
rule this is one instance of.

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
`src/app/globals.css`, sRGB compositing, WCAG 2.x relative luminance. AA for normal text is
**4.5:1**, and contrast is size-independent — a 12px badge and a 16px paragraph face the same bar,
because none of this is "large text" (18pt / 14pt bold).

The `-strong` tokens are `color-mix(in srgb, black 6%, var(--success|--warning))`. The `-tint`
fills are `color-mix(in srgb, var(--<hue>) 10%, var(--surface))` — **opaque**, which is what makes
"on its own tint" a single number rather than one per parent. See the note under the table.

**Light palette** (`--surface` `#ffffff`, `--background` `#faf9f6`, `--surface-sunken` `#f1efe9`):

| text | on `bg-surface` | on its own `-tint` | on `bg-background` | on `bg-surface-sunken` |
| --- | --- | --- | --- | --- |
| `text-success` | 5.02 | **4.38** | 4.76 | **4.36** |
| `text-success-strong` | 5.56 | 4.86 | 5.28 | 4.84 |
| `text-warning` | 5.02 | **4.39** | 4.77 | **4.37** |
| `text-warning-strong` | 5.56 | 4.86 | 5.28 | 4.83 |
| `text-danger` | 6.47 | 5.45 | 6.15 | 5.63 |

**Dark palette** (`--surface` `#0d222d`, `--background` `#071720`, `--surface-sunken` `#051118`):

| text | on `bg-surface` | on its own `-tint` | on `bg-background` | on `bg-surface-sunken` |
| --- | --- | --- | --- | --- |
| `text-success` | 9.39 | 7.59 | 10.46 | 10.96 |
| `text-success-strong` | 8.30 | 6.71 | 9.24 | 9.69 |
| `text-warning` | 9.80 | 8.01 | 10.92 | 11.44 |
| `text-warning-strong` | 8.66 | 7.08 | 9.65 | 10.11 |
| `text-danger` | 5.91 | 5.20 | 6.59 | 6.90 |

Bold is under AA. Read off it:

- **A coloured ink sits on `bg-<hue>-tint`, never on `bg-<hue>/10`.** The `/10` form is
  translucent, so the real background is the hue mixed over *whatever is behind the element*, and
  every number in these tables assumed that was `--surface`. It frequently is not: a pill rendered
  straight onto `--background` measured 4.21:1 where the table says 4.86, and a `bg-primary/10`
  badge nested inside a `bg-success/10` row on `/check-in` reached 4.09:1 — the worst in the app,
  and invisible to anyone reading the palette (issue #793). The opaque token is the table's number
  wherever the element is mounted, including inside a sunken panel, which is why the old "a tinted
  status fill does not go inside a sunken panel" rule is gone. Reach for `Badge` and this is
  already handled.
- **Light is the binding scheme.** Every dark-palette combination clears AA by a wide margin.
  Mixing black into an already-light-on-dark hue *lowers* contrast, so `-strong` is a light-mode fix
  that costs a little in dark and never rescues anything there. It is still safe everywhere, which
  is why one token can serve both schemes.
- **On a tint of its own hue, success/warning text is `-strong`.** The raw hue lands at
  4.38–4.39, just under. `danger` needs no `-strong` and has none.
- **On `bg-surface-sunken`, success/warning text is `-strong`** even with no tint (4.36 → 4.84).
  This is why `StatTile`'s figure uses `-strong`: the tile's `inset` variant is a sunken box.
- **On plain `bg-surface`, the raw hue is fine** (5.02) — and that is exactly why a component that
  does not know what it is mounted on may not rely on it. `KindChip` named `bg-surface` on *itself*
  so it could; its replacement, `LedgerRow`'s kind word (`src/components/ui/ledger.tsx`), carries no
  fill at all, so it takes `text-warning-strong` (5.56 / 4.83 / 4.86 — clears on surface, sunken and
  tint alike) and keeps `text-danger`, which needs no `-strong` at any of them. The case is not
  hypothetical: a `LedgerRow` that is a door hovers to `bg-surface-sunken/60`, where the raw hue is
  4.37. **The general rule this is an instance of:** a component mounted in whatever container its
  caller chose picks the ink that clears everywhere, rather than the one that clears where its
  author happened to be looking — `FormStatus` and `ShopStat` already settle it the same way. A
  `className` override is not the escape hatch, because Tailwind emits colour utilities
  alphabetically by token name and the override would win or lose by that accident.
- **`opacity-*` dims the ratio too.** A row greyed out with `opacity-60` takes its own status chip
  down with it — 2.81:1 on the import preview, on a table whose whole job is being read. Quiet ink
  is `text-muted`, which is a token with a measured ratio; opacity is not.
- **A `/15` fill is a different question, and the answer is the skin.** Measured across all three
  palettes at a 15% fill of the ink's own hue: **boat light bottoms out at 4.98:1** and boat dark at
  5.50:1, against the **app palette's 3.90:1** for the same pair. So the roll-call surfaces that use
  one are compliant where they render and the app-palette ones are not — the shop home's first-run
  tick was at 4.33:1 until it moved to `bg-success-tint` (issue #874). `scripts/check-tinted-ink.mjs`
  knows which files render under boat mode; everywhere else, use the opaque token.
- **Boat mode is exempt from all of it.** `.boat-mode` retunes the feedback hues for a deck in
  sun; its worst tinted-fill combination measures 5.40:1 in light and 5.32:1 in dark, so the
  roll-call fills that use the raw token there are compliant and stay as they are.

Since 2026-08-23 this is enforced rather than remembered: `e2e/a11y.spec.ts` runs axe's
`color-contrast` rule with no exclusion list, over every surface it scans.

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

## Empty states: `EmptyState`

`title` (required), `body`, `action`. **No `children`** — the component owned the box and left the
inside to the call site, so 46 of them invented 46 anatomies and twenty were a single muted sentence
with no heading at all: `brand.md`'s "No records found" wearing a nicer border, on a surface whose
own principle says empty states *teach* (issue #774).

- **`title`** is the teaching line — what is not here, and usually why. "No trips yet — schedule
  your first charter", not "No records found".
- **`body`** only where the title alone leaves the reader guessing.
- **`action`** where there is a next step. It is optional on purpose: some of these are states the
  reader cannot do anything about — no reviews written yet, no waivers signed yet — and a required
  action prop would manufacture a button for them.
- **`titleAs`** picks `h2` or `h3`, exactly as `SectionCard` does. The look is the component's; the
  *level* is document structure and depends on how deeply the card is nested.
## Motion: write a bare `transition-*`

The app has three curves, declared in `@theme` in `globals.css` and argued for there:
`--ease-out-soft` for arrivals, `--ease-in-soft` for exits (its mirror — an exit on an ease-*out*
curve reads as a jump then a pause then a hard cut), and `--ease-spring`, rationed like `--accent`.

**The default is one of them, so the obvious thing is now the right thing.** `transition-colors`
with no easing and no duration gets `--ease-out-soft` at 200 ms. That is deliberate and there is no
lint rule against it: the curve used to default to Tailwind's `cubic-bezier(0.4, 0, 0.2, 1)`, so 31
of the app's 35 transitions were on a fourth curve nobody chose while the two authors who noticed
each wrote their own workaround — a cubic-bezier literal in `button.ts`, `ease-[var(--ease-out-soft)]`
in the waiver's progress bar (issue #833).

- **Arrival** — nothing. Omit both; the default is the arrival.
- **Exit** — `ease-in-soft`, and say the duration if it differs.
- **Weight** — `ease-spring`, for something that *unfolds on request*. A lie on anything that
  merely appears.
- **A duration that is not 200 ms** — write it, and it should be because the motion means something
  different, not because 260 ms was what got typed. The only two left in the app are the hold-to-
  unlock gauge's 75 ms and 100 ms, which are a gauge rather than an arrival.
- **`transition-brand`** stays for a surface whose hover changes several things at once; it reads
  the same defaults.

Transform and opacity only ([principle 5](principles.md)). Animating `box-shadow` or a colour on a
large surface paints every frame — `.card-scale-hint` did exactly that, with a literal
`rgba(0, 0, 0, 0.05)` shadow invisible on the dark palette, so half the readers paid for an effect
none of them saw.

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

## Reef's rungs, as they ship (2026-09-02)

The system sheet of [ADR 20260901-diveday-reimagined](../architecture/decisions/20260901-diveday-reimagined.md)
drew the parts at sizes the first slices did not all land. They are these now, and each is pinned:

- **Radius**: control 10 (`rounded-lg`, `--radius`) · inset 18 (`rounded-inset`, the sunken block
  a card carves out of itself — a fieldset on the tideline, a nested list, a photo tile, a toast) ·
  panel 28 (`rounded-panel`, the card and every tone-carrying panel that is a card's sibling) · pill
  999. Tailwind's own `rounded-xl` and `rounded-2xl` are not rungs and `card.test.tsx` refuses them.
- **Buttons**: `md` is **48px tall with a 16px label**, the sheet's default; `sm` stays 44/14 for a
  table row or a chip row; `boat` stays the 56px dock target. The base's `min-h-11` is still the
  floor every size clears.
- **Rows**: a `LedgerRow` is never tighter than **52px** (`md`); `lg` is 56.
- **The ⌘K cap** belongs to the command palette's trigger in the header, not to `SearchField`: a
  real `<input>` does not advertise a global shortcut it does not own. The sheet drew them as one
  field; the split is deliberate.
- **`Field`'s `hint` vs `description`**: the sheet's "On the back of the card, under the name" is
  the *below* slot, which is `description`; `hint` rides inline inside the label.

## Searching a list: `SearchField`

A staff list that can be searched renders **one search box and nothing around it** —
`SearchField` in `src/components/ui/form.tsx`: a `type="search"` control wearing `controlClass`, a
magnifier in its leading inset, its label `sr-only`, no caption above it and no "Search" button
beside it. A form with one text control submits on Enter; surfaces that want type-to-apply drive
`requestSubmit()` from `onInput`, as the orders toolbar and the counter do.

```tsx
import { SearchField } from "@/components/ui/form";

<QueryForm aria-label={t("diveSites.list.searchAriaLabel")} className="mb-6 flex items-center gap-2">
  <SearchField id="site-search" name="q" label={t("diveSites.list.searchLabel")}
    defaultValue={query} placeholder={t("diveSites.list.searchPlaceholder")} className="w-full sm:w-80" />
</QueryForm>
```

Four grammars for this control coexisted until 2026-09-01 — the orders toolbar's bare box, the
diver roster's bare box, the dive-site library's bordered card with a "Find a site" caption and a
Search button, and the counter's captioned box with a "Search queue" button — and which one a page
got was a function of when it was written. The Clearwater decision that demoted the orders filter
card to a toolbar is the precedent (ADR 20260827-clearwater-surface-language, decision 7): a search
is a toolbar control, and the glyph is what says so. The seat-diver picker (`PersonSearchForm`) is
the one search that still carries a visible caption and a Search button: it is a step in a flow
rather than a list's toolbar, and its button is a keyboard-reachable target the e2e suite drives.

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
