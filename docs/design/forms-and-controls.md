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
`rounded-panel border border-border bg-surface shadow-bed` — so **a card, a stat tile and a table
shell read as the same object**. `rounded-panel` is the panel rung, 20px (the ladder is under
[The rungs, as they ship](#the-rungs-as-they-ship)).

**A resting panel sits on the bed.** `shadow-bed` is the one soft shadow a panel wears: a token
(`--shadow-bed`, two neutral layers, redrawn for the night palette), so it moves with the palette
and never with a call site. Clearwater took every panel's shadow away on 2026-08-28 (ADR
20260827-clearwater-surface-language, decision 1: **elevation is earned**), and Reef put this one
back for the panel alone (ADR 20260901-diveday-reimagined, 13a). Everything else still follows
Clearwater: a menu, a sheet, a dialog and a toast carry `shadow-lg`/`shadow-2xl` because they float
above the page, and `card.test.tsx` fails the build on any `rounded-panel` class string that also
carries `shadow-sm`. Round 2's surface (ADR 20260918-nothing-to-explain, slice 22b) says "no bed".
The code has kept it, and whether it should stay is #1965.

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
  stop stacking surface on surface. The panel's elevation is now the bed, the same at every call
  site, so there is nothing left to switch, and an option that can only ever be a no-op is a call
  site asking for an elevation it will never get.
  `Table`'s `flush` and `ShopStat`'s `inset` still follow containment — they drop the *border and
  fill*, which is a different question.
- **The heading is folded in.** Pass `title`; never spell a heading class at a call site. The
  card's `h2` is `LEAD_TITLE_CLASS` from `src/components/ui/typography.ts` (`text-2xl font-semibold
  tracking-tight`, 24px). `titleAs="h3"` steps a card down one level, to `text-base
  font-semibold` (16px), when it sits under a group that already owns the `h2` (the export page's
  Backups half). It changes the element *and* its size, so a group and the five cards under it
  never shout at the same volume.
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
  className={LEAD_TITLE_CLASS}>`, the **same scale** as a card's own `h2`, because a section speaks
  at one volume whether its heading sits inside one card or above five. Each card under it steps
  down with `titleAs="h3"`, or carries the object's own name when the card *is* a thing. The tree
  does not keep this yet: most hand-spelled section headings still wear `SECTION_TITLE_CLASS`
  (`text-lg`, 18px) beside titled cards at 24px, and #1966 picks the one size.
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

**The hand-spelled anatomies place by this grammar too.** The marketing pages keep their own type
scale at the call site (`card.tsx`'s docblock), but that is a *type-scale* exemption, not a
placement one, and the marketing pages already prove it: `/product`'s mid-CTA heading sits
**inside** its card, hand-spelled at `SUB_TITLE_CLASS` under the chapter's 36px heading, where the
card's own `h3` rung (`text-base`) would turn the page's one checkable proof into fine print. The
same goes for a tone-carrying panel, a full-bleed shell, and an eyebrow. Each hand-spells its
heading for a reason stated at the site, and each still *places* it by this grammar. So does a card
that is a `<form>`: `SectionCard`'s element set excludes `<form>`, so such a card cannot take a
`title` at all, and its heading is hand-spelled at the `h2` scale as the card's first child
(`BookActivity` on the diver record) rather than floated above it.

**A tone does not change a heading's volume.** A warning, success or primary-tinted panel spells its
`h2` on the same rung as an untoned one, keeping whatever tone colour it carries: scale carries
hierarchy, colour carries state. A heading that grew or shrank because something went wrong would
move the page's apparent structure as panels change state, and a reader would re-learn the
hierarchy every time — so a tone-carrying panel's heading is never quieter for having a tone, and
never louder for it either. The trip's prep page breaks this today: its two warning panels are
`LEAD_TITLE_CLASS` and its untoned sections `SECTION_TITLE_CLASS`, which is part of #1966.

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
- Horizontal checkbox/radio rows are not stacked fields — they are `ChoiceRow`s or `ChoicePill`s
  (below), never a `Field`.

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
  button *is* the label — one control, one tap target, one focus stop (the label draws the ring,
  with `has-[:focus-visible]:focus-ring`; see [Focus rings](#focus-rings-one-ring-two-placements));
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

**Nothing lands under it.** The bar marks itself `data-sticky-actions`, and `globals.css` pads the
viewport's bottom by its height (`html:has([data-sticky-actions]) { scroll-padding-bottom }`), the
twin of the chrome bar's `scroll-padding-top`, so a field that takes focus or a fragment a link
jumps to scrolls into view above it. The height is measured, not assumed: the bar is a wrapping row,
and the unsaved-changes sentence beside Save wraps under it at 390 whenever the form is dirty, so
`StickyActionsInset` writes the bar's live height to `--sticky-actions-h` and the rule falls back to
the one-row 73px only until it has. Its bleed is spelled for the containers it sits in — a
`<main>` padded `px-4 sm:px-6`, and from `lg` the editor rail's unpadded form cell — so its rule
runs to the screen's edges on a phone and with the form's column on a desk.

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

Settled by measurement, so nobody has to re-derive it. The ratios below are computed from the token
values in `src/app/globals.css` on Tide's palette (recomputed 2026-09-25), with sRGB compositing and
WCAG 2.x relative luminance, and truncated to two places so a figure never overstates. AA for
normal text is **4.5:1**, and contrast is size-independent — a 12px badge and a 16px paragraph face
the same bar, because none of this is "large text" (18pt / 14pt bold).

The `-strong` tokens are `color-mix(in srgb, black 6%, var(--success|--warning))`. The `-tint`
fills are drawn values, one per hue per scheme (`--success-tint` is `#e3f2ea` by day and `#0b2617`
at night), and **opaque**, which is what makes "on its own tint" a single number rather than one
per parent. See the note under the table.

**Light palette** (`--surface` `#ffffff`, `--background` `#f2f2f7`, `--surface-sunken` `#ececf1`):

| text | on `bg-surface` | on its own `-tint` | on `bg-background` | on `bg-surface-sunken` |
| --- | --- | --- | --- | --- |
| `text-success` | 5.42 | 4.69 | 4.86 | 4.61 |
| `text-success-strong` | 5.97 | 5.16 | 5.35 | 5.07 |
| `text-warning` | 5.42 | 4.80 | 4.86 | 4.60 |
| `text-warning-strong` | 5.97 | 5.28 | 5.35 | 5.07 |
| `text-danger` | 5.38 | 4.65 | 4.82 | 4.57 |

**Dark palette** (`--surface` `#1c1c1e`, `--background` `#000000`, `--surface-sunken` `#0b0b0d`):

| text | on `bg-surface` | on its own `-tint` | on `bg-background` | on `bg-surface-sunken` |
| --- | --- | --- | --- | --- |
| `text-success` | 8.41 | 7.96 | 10.38 | 9.72 |
| `text-success-strong` | 7.43 | 7.03 | 9.17 | 8.59 |
| `text-warning` | 8.27 | 7.90 | 10.21 | 9.56 |
| `text-warning-strong` | 7.31 | 6.98 | 9.02 | 8.45 |
| `text-danger` | 4.99 | 5.08 | 6.16 | 5.77 |

Nothing in either table is under AA. The rules below were set on the Clearwater palette, where the
raw success and warning hues measured 4.36–4.39 on a tint or a sunken fill and failed. On Tide's
palette the raw hues clear those fills by 0.1–0.3, and `-strong` clears them by 0.5 or more, so the
components still use `-strong`. Read off it:

- **A coloured ink sits on `bg-<hue>-tint`, never on `bg-<hue>/10`.** The `/10` form is
  translucent, so the real background is the hue mixed over *whatever is behind the element*, and
  every number in these tables assumed that was `--surface`. It frequently is not: a pill rendered
  straight onto `--background` measured 4.21:1 where the palette's own table said 4.86, and a
  `bg-primary/10` badge nested inside a `bg-success/10` row on `/check-in` reached 4.09:1 — the
  worst in the app, and invisible to anyone reading the palette (issue #793). The opaque token is
  the table's number wherever the element is mounted, including inside a sunken panel, which is why
  the old "a tinted status fill does not go inside a sunken panel" rule is gone. Reach for `Badge`
  and this is already handled.
- **Light is the binding scheme for success and warning.** Every dark-palette pairing of those two
  clears AA by a wide margin. Mixing black into an already-light-on-dark hue *lowers* contrast, so
  `-strong` is a light-mode fix that costs a little in dark and never rescues anything there. It is
  still safe everywhere, which is why one token can serve both schemes. `danger` is the tightest ink
  in both schemes: 4.57 on a light sunken fill, 4.99 on the dark surface.
- **On a tint of its own hue, success/warning text is `-strong`.** The raw hue lands at 4.69–4.80
  (4.38–4.39 on Clearwater's palette, just under). `danger` needs no `-strong` and has none.
- **On `bg-surface-sunken`, success/warning text is `-strong`** even with no tint (4.60 → 5.07).
  This is why `ShopStat`'s figure uses `-strong`: the tile's `inset` variant is a sunken box.
- **On plain `bg-surface`, the raw hue is fine** (5.42) — and that is exactly why a component that
  does not know what it is mounted on may not rely on it. `KindChip` named `bg-surface` on *itself*
  so it could; its replacement, `LedgerRow`'s kind word (`src/components/ui/ledger.tsx`), carries no
  fill at all, so it takes `text-warning-strong` (5.97 / 5.07 / 5.28 on surface, sunken and tint)
  and keeps `text-danger`, which needs no `-strong` at any of them. The case is not hypothetical: a
  `LedgerRow` that is a door hovers to `bg-surface-sunken/60`, where the raw hue measured 4.37 on
  Clearwater's palette (4.92 today). **The general rule this is an instance of:** a component
  mounted in whatever container its caller chose picks the ink that clears everywhere, rather than
  the one that clears where its author happened to be looking — `FormStatus` and `ShopStat` already
  settle it the same way. A `className` override is not the escape hatch, because Tailwind emits
  colour utilities alphabetically by token name and the override would win or lose by that
  accident.
- **`opacity-*` dims the ratio too.** A row greyed out with `opacity-60` takes its own status chip
  down with it — 2.81:1 on the import preview, on a table whose whole job is being read. Quiet ink
  is `text-muted`, which is a token with a measured ratio; opacity is not.
- **A `/15` fill is a different question, and the answer is the skin.** At a 15% fill of the ink's
  own hue over each scheme's surface, ground and sunken fill, **boat light bottoms out at 4.99:1**
  and boat dark at 5.59:1, against the **app palette's 3.50:1**. So the roll-call surfaces that use
  one are compliant where they render and the app-palette ones are not — the shop home's first-run
  tick was at 4.33:1 until it moved to `bg-success-tint` (issue #874).
  `scripts/check-tinted-ink.mjs` knows which files render under boat mode; everywhere else, use the
  opaque token.
- **Boat mode is exempt from all of it.** `.boat-mode` retunes the feedback hues for a deck in
  sun; its worst tinted-fill combination at 10% measures 5.40:1 in light and 6.16:1 in dark, so
  the roll-call fills that use the raw token there are compliant and stay as they are.

Since 2026-08-23 this is enforced rather than remembered: `e2e/a11y.spec.ts` runs axe's
`color-contrast` rule with no exclusion list, over every surface it scans.

`FormStatus` uses `-strong` unconditionally for those two tones. It is mounted in whatever container
its form is in — a card footer, a disclosed settings row, a sunken inset panel — and it is the
component that tells a staffer a save was refused, so it does not get to be the one that guessed.

### The tone marks: `StatusMark`

One mapping, `toneMark()` in `src/components/ui/tone.ts`, and one drawing,
`src/components/ui/StatusMark.tsx`, shared by `Badge`, `FormStatus`, and `ShopNotice`. Only the
three pass/fail/caution tones get a mark. `primary` and `neutral` are counts and labels, so
`toneMark()` returns `undefined` for them and a caller cannot mark a count. `Badge`'s
`toneMark={false}` turns the mark off for a count that wears a status tone.

The marks are **drawn SVG, not emoji and not text dingbats**: a check in a circle (success), a
triangle holding a bar and a dot (warning), a cross in a circle (danger). Each is drawn on a
24-unit grid with a 1.9 stroke in `currentColor`, so it takes the ink of the words beside it and
stays a distinct shape in monochrome (ADR 20260827-the-departure-is-two-working-surfaces, decision
5). They are `aria-hidden`, and the words carry the status. Sizes: `sm` is 16px (`size-4`, the
default, and every `Badge` below `lg`), `md` is 20px (a `lg` `Badge`), and `lg` is 24px. The gap
belongs to the consumer's layout: `gap-1` in a `Badge`, `gap-1.5` in `FormStatus`, `me-1` in
`ShopNotice`.

These replaced the emoji (✅ ⚠️ ❌) on 2026-08-29. The emoji had replaced text dingbats (`✓ ▲ ✕`),
which took the surrounding font and read at badge size as a font falling back. Don't swap a glyph
back in.

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
  different, not because 260 ms was what got typed. The ones left in the app are the water
  locker's hold-to-unlock gauge (75 ms and 100 ms), the roll call head count's water (300 ms) and
  the pull-to-refresh arrow (150 ms). Each is a gauge following a finger or a count, not an
  arrival.
- **`transition-brand`** stays for a surface whose hover changes several things at once; it reads
  the same defaults.

Transform and opacity only ([principle 5](principles.md)). Animating `box-shadow` or a colour on a
large surface paints every frame — `.card-scale-hint` did exactly that, with a literal
`rgba(0, 0, 0, 0.05)` shadow invisible on the dark palette, so half the readers paid for an effect
none of them saw.

## Focus rings: one ring, two placements

Every control gets the global ring from `globals.css` — 3px of `--focus-ring` at a 2px offset,
reaching 5px outside the box — and a call site never draws a ring of its own. The rule lives in
`@layer base` so the two utilities beside it can move it. It used to be unlayered, which beat every
Tailwind utility whatever its specificity: the trip's About summary and the offline manifest's rows
asked for an inset ring, rendered the global one at +2px, and the `overflow-hidden` card around
them cut it away. The pixel probe's first pass counted 1,700 clipped rings.

- **`focus-ring`**, under `has-[:focus-visible]:` or `peer-focus-visible:`, is for a stand-in:
  focus lands on something invisible and the eye reads another box as the control. The label
  around an `sr-only` input (`ImageFileInput`, a weekday chip, a tip preset), a switch's track.
  `has-[:focus-visible]` rather than `focus-within`, so it lights for the keyboard the way the
  global rule does.
- **`focus-visible:focus-ring-inset`** is for an element flush with an `overflow-hidden` or
  scrolling edge: a list card's rows, a scroll box's options, the command palette's field, a
  `flush` ghost whose 8px of fill leave less than the ring's 5px to a clipping edge (a `p-3` row in
  a clipped list: seasons, kinds of day, boats) or to a visible one the ring would cross (a
  `Copyable` panel's 12px inset, a security session row), and an `outdent` button whose box ends
  4px above a clipped list's rule (the team card's Disable). A ledger row's door and a
  folded horizon's `<summary>` take it too: each is the row's whole box, rule to rule, so the
  outset ring crossed both hairlines. It is the same 3px, drawn
  wholly inside the box, and on the element's own fill (the contrast of each fill is in the
  utility's comment in `globals.css`). Where the row meets the container's rounded corner it
  takes the container's radius too, or the clip shaves the ring's square corner —
  `LIST_ROW_SUMMARY_RING` in `src/components/ui/disclosure.tsx` for a `<summary>` row, which
  cannot `inherit` a radius through its `<details>`. Never remove the container's
  `overflow-hidden` to make room: it is what rounds the rows' hover fills.
- **Room, not an inset ring,** for chips in a strip that scrolls sideways (`FilterChips`, the
  product page's chapter strip): vertical padding on the scroller for the 5px, and the same
  negative margin so nothing around it moves. A negative top margin collapses through a parent
  with no top border or padding, so that parent is `flow-root`. Room too where the row's
  padding was the defect: the diver record's shelf rows had `px-1` in an `InsetGroup` and now
  take its `px-5 py-4 sm:px-6`.
- **Never switch the outline off** on an `a`, `button`, `input`, `select`, `textarea` or
  `summary`. In `@layer base` the global rule loses to `outline-none`, so it now does what it
  says and leaves a keyboard user nothing. The two exceptions show focus on another box:
  `RowLink`'s text (its `::after` overlay is ringed) and the tip picker's amount field (the
  bordered box around it is).
- **A positioned child paints over its parent's outline.** An inset ring on a link that holds a
  photo is hidden under the photo. The storefront's course cards moved the clip from the card onto
  the link instead, which keeps the global ring: an element's `overflow` never clips its own
  outline.

`src/app/focus-ring.test.ts` refuses a width or an offset under any focus variant, and an outline
switched off anywhere but an element the global rule never rings (in practice a `tabIndex={-1}`
container a script moves focus into) and those two exceptions. It also lists the elements the
probe measured a clip cutting whose components do not render in jsdom; the rest are pinned in
their own components' tests. These read classes, not pixels: the pixel probe measures the ring.

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

Variants: `primary`, `secondary`, `outline` (`secondary` with the `--border-strong` edge that holds
3:1 against the page's ground, for the public pages; staff keep the hairline), `ghost`, `danger`,
`danger-ghost` (the danger hue without the box, for a destructive row in a quiet menu),
`danger-solid`, `link` (reads as inline text but still claims a full target), `sky` (a translucent
chip for a control standing on a `SkyBand`), and `bare` (shape and target only, for a control whose
fill is the state of its row). Sizes: `md` (the
default, 48px with a 16px label), `sm` (44px with a 14px label), `boat` (56px with a 16px
semibold label), `icon` (a 48px square), `icon-sm` (a 44px square, for a glyph in a row of `sm`
controls), and `mark` (a 56px circle, for the roll call). The corner is the control rung,
`rounded-lg` (12px), unless `shape: "pill"` asks for a pill; `mark` is always round. A radius
passed through `className` loses to the rung by stylesheet order, so `button.test.ts` refuses one.
Pass one-off adjustments through `className`; do not rebuild the base. If you find yourself
cancelling a variant's own styles, the variant is wrong — add one.

**`primary` is the one thing in the app that carries a `shadow-sm` at rest**, and it is an
exception stated at the rule rather than a second rule: ADR
[20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md)
decision 1 says why, and why no other variant may follow it. Do not sweep it away.

**The size follows the surface, never the button's importance.** Importance is the variant's job.
A page header, a form's action row, a card body and a dialog take `md`; a ledger row, a table cell
and a chip row take `sm`; and every button in one row takes the same size. A 16px primary beside a
14px "Cancel" was the app's most repeated drift (nine rows on 2026-09-03), and the former `lg` and
`cta` rungs — `md` with 4px more padding, or with a heavier weight — went with it: a call to action
is made by being the row's one primary, or by `w-full` on a phone, never by its own type size.
`icon` is a 48px square so it sits level with `md` in a header or a pager.

**A row with a text control in it is an `md` row.** A control's type is 16px at every size, because
iOS Safari zooms the page when a box under 16px takes focus, so the only button it can stand level
with is `md`, whose label is 16px too. `sm` beside a box matches its 44px and not its type. The
control then takes md's height: `controlClassFor("md")` (48px) for an input or select, placed by hand
or in a `Field` that shares its line with the button, and `size="md"` on `SearchField`.
`controlClass` stays the 44px `field` size for a control stacked in a `Field` whose line holds no
button, alone in a toolbar, or in a row of controls only. The pixel probe found the two sizes
together on 2026-09-25: a 44px search box beside a 48px "Add diver" on the trip roster's seat-diver
door and the diver roster, and a 16px box beside a 14px "Go" or "Save" wherever a row reached for
`sm` to match the box's height. The probe groups a control inside a `Field` with its caption, not
with the row, so it cannot see a `Field` beside a button: read those rows.

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

**What `flush` does depends on what the variant paints.** `link` and `bare` paint nothing of their
own around their words (a link's hover is an underline), so their padding goes to `px-0`. `ghost`
and `danger-ghost` paint only on hover, and their tint with the padding gone sat 0px from either
side of "Delete Morgan Vale" (pixel probe, 2026-09-25), so they get `-mx-2 px-2`: the label sits
where a padless one would, and the tint reaches 8px past it. A ledger row keeps the same 8px, for
the same reason (`FILL_ROOM` in `src/components/ui/ledger.tsx`). The variants painted at rest
(`primary`, `secondary`, `outline`, `danger`, `danger-solid`, `sky`) are boxes, and a box lines up
by its edge, not its label, so the type refuses `flush` on them.

**`flush` is for the button that starts or ends a line, and the row gives back what it gave up.**
Mid-row, among other words, a quiet button keeps its padding: that is what keeps its hover fill
off its neighbours. Where it starts a line, its padding was part of the space to the next control,
so the row's gap takes it back — 12px more beside a padded neighbour (the staff credentials' review
and Remove, `gap-2` to `gap-5`), 24px more between two flush ones (the display links' Renew and
Revoke) — or the fill ends where the next box begins. A component that draws the button for many
callers takes `flush` as a prop (`Copyable`), because only the caller knows where it sits. The
button test refuses the hand cancels `flush` replaced, in a `buttonClass` call and on a row that
wraps a quiet button.

**A quiet button that ends a padded box passes `outdent`, `flush`'s vertical twin.** A `ghost`
`sm` is a 44px box around a 20px line, so 12px of box sits under its word; last in a card, that box
adds to the card's padding (the team card measured 21px over the name and 33px under "Disable").
`outdent: "block-end"` gives the unseen half back as a negative bottom margin and keeps the target
whole; `"block-end-phone"` does it below `sm` only, for actions that drop to a line of their own
there. Never on a button that shares its line with a visible box: centred in the row, it would
rise by half the margin. The box then ends `padding − 12px` from the container's edge, so with
under 17px of padding its 5px ring needs drawing inside (the team card, 16px) or the container
needs the padding (the safety checklist's rows, `max-sm:py-5`).

The same trap applies to the type scale, which is why it lives on the sizes: a `text-base` passed
through `className` cannot reliably beat a size's `text-sm`. Pick the size that already says it.

**Anything else that sets a `min-h-*` floor** — a `<summary>`, a nav chip, a wrapper — still has to
center its own content: give it `flex items-center` or `inline-flex items-center`. A height floor
without centering is the bug.

## Switches: `Switch`

A setting that takes effect **the moment it is tapped** is a switch: `src/components/ui/Switch.tsx`,
a visually hidden `<input type="checkbox" role="switch">` inside a `<label>`, drawing a track and a
sliding thumb. Two surfaces drew it by hand with byte-identical class strings — the water locker's
spray-guard toggle and the haptics toggle — which is the drift `buttonClass()` and
`SegmentedControl` each exist to end. **Track-and-thumb class strings are never written at a call
site.**

```tsx
import { Switch } from "@/components/ui/Switch";

<Switch checked={enabled} onChange={setEnabled} label={copy.label} />;
```

`onChange` hands back the new boolean rather than a change event, because that is what every caller
wants. The label's words are the accessible name *and* a tap target; `aria-checked` is derived from
the same prop as `checked`, so the two cannot disagree; the thumb moves on a bare
`transition-transform`, so `prefers-reduced-motion` stills it through the global kill-switch; the
label is `min-h-11` around a 44×24 track and a 16px thumb, and the whole control is
`print:hidden`.

**A checkbox is not a switch, and the difference is when it takes effect.** A choice that only means
something once a form is submitted stays a plain checkbox — Settings → Team's role and language
boxes, a departure's requirement toggles, the buddy-team and waiver boxes, roughly 25 sites. None of
those should slide: a control that animates into its new state is telling the reader something
happened, and until the form is submitted nothing has.

## Checkboxes and radios: `ChoiceRow`, `ChoicePill`, `choiceClass`

A checkbox or radio a person sees is drawn one way, from `src/components/ui/form.tsx`:

- **`choiceClass`** is the box: `size-4 shrink-0`, 16px and never squashed beside a label that
  wraps. The colour is `globals.css`'s `accent-color` on every input, not a utility.
- **`ChoiceRow`** is a box with its words beside it — a waiver's agreement, a readiness answer, a
  publish choice. The label is the whole row, at least 44px tall, and the box sits on the middle of
  the words' first line however many lines they wrap to.
- **`ChoicePill`** is the bordered answer pill — Yes / No on the medical questionnaire, a call's
  outcome, a staffer's roles — 44px, `px-4`, one hover. `size="md"` sets its words at 16px for a
  diver-facing form whose copy is 16px. `aside` holds what sits beside the words and must stay out
  of the box's name — a rental item's explainer and price: the pill becomes a bordered `<div>`
  around its label and the aside, with the box on the plain pill's 16px inset.
- **`ChoiceFieldset`** captions a group of them the way `Field` captions a control: a
  `text-sm font-medium` legend, then 4px, then the body (`bodyClassName` lays the choices out).
  `required` draws `Field`'s aria-hidden `*`. Hand-rolled legends put 8px there (`mb-2`, `mt-2`),
  so a group sat further from its caption than every field around it; `form.test.tsx` refuses a
  legend with its own bottom margin (a floated legend aside).

```tsx
<ChoicePill type="radio" name="outcome" value="cleared" required>
  {copy.outcomeCleared}
</ChoicePill>
<ChoiceRow type="checkbox" name="acknowledged" value="on" required className="mt-4 text-base">
  {t("waiver.agreementCheckbox")}
</ChoiceRow>
```

Both pass every input prop to the box (`name`, `value`, `checked`/`onChange`, `aria-*`, `ref`) and
take `className` for the row. Before them the pill was spelled by hand a dozen ways and radios were
left at the platform's 13px beside 16px checkboxes (the pixel probe, waiver-active). `form.test.tsx`
refuses a visible box that does not wear `choiceClass` (the conditions hold and the buddy builder's
drag rows are 20px on purpose, and named there), one wearing the forms plugin's `rounded border-*
text-primary focus:ring-*` (not loaded here, and inert on a native box), and a pill spelled by hand,
a bordered `<div>` around a label included.

A box with words is a `ChoiceRow`, not a `Field`: `Field` wraps a child that is not one control in
a `<label>`, so a row inside it is a label in a label. Where a row needs a field's caption beside
it, give the `Field` `htmlFor` and the row's box that `id`, as the departure's private and
self-guided boxes do.

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
  rail with wet hands and glare (the manifest's checkpoint row). Everything else takes the default,
  `md`: 44px with 14px labels. The track is `rounded-inset`, 12px. The pill, the options and their
  hover fill sit 5px inside it (a 1px border and `p-1`), so they take its corner less that inset:
  7px, `SEGMENT_CORNER`. They wore `rounded-lg` until 2026-09-25, a 12px curve 5px inside a 12px
  one, and the pixel probe flagged it on 42 captures.
- **The pill slides.** The raised pill is one element that travels from the option it was on to
  the one it is on now — a FLIP on `transform`, on the arrival curve — so a tap explains where the
  selection went. Every option is still a navigation; the component keeps the last measured box
  across the re-render and starts the pill from there. Before JavaScript the current option draws
  its own fill, so nothing depends on the effect to look selected.
- **The current item is inert by default** — a `<span>` with `aria-current="page"`, because a tab
  bar's "you are here" is not a destination. A control whose options are views of the *same* page
  (`?view=`, `?checkpoint=`) passes `currentIsLink` (a re-tap is a harmless reload),
  `ariaCurrentValue="true"`, and `scroll={false}` so switching views holds the reader's place.
- Labels arrive resolved: staff copy is server-side only, so each call site translates its own
  options and passes words.

**A segmented choice inside a form takes the parts, not the component.** The booking's party size
and the embed page's look are radios: their value has to reach `FormData`, and a `<nav>` of links
cannot carry one. They draw the same track and segments from `src/components/ui/segmented.ts` —
`segmentedTrackClass` and `segmentClass({ selected })`, which `SegmentedControl` itself uses — and
keep only their own target size and focus treatment. They were copies until 2026-09-25, and each
copy had kept the mis-nested corner; `segmented.test.ts` now fails on a track spelled anywhere else.

**Not for same-page anchors.** A row that jumps to sections of the page you are already on is
`src/components/JumpNav.tsx` — link-buttons under a hairline rule — and it stays visually distinct
on purpose. A segmented track marks one option current; a jump row can never mark anything current,
because every entry is on this screen. Two controls that look identical and mean different things
is the exact drift both components exist to end, so never dress a jump row as a track, or a tab bar
as a row of links.

## The rungs, as they ship

The system sheet of [ADR 20260901-diveday-reimagined](../architecture/decisions/20260901-diveday-reimagined.md)
set the parts' sizes on 2026-09-02, and Tide's surface
([ADR 20260919-one-idea](../architecture/decisions/20260919-one-idea.md), decision I) re-cut the
radii on 2026-09-19. They are these now:

- **Radius**, Tide's ladder: control 12 (`rounded-lg`, `--radius`) · inset 12 (`rounded-inset`,
  the sunken block a card carves out of itself — a fieldset, a nested list, a photo tile, a menu
  panel, a toast) · panel 20 (`rounded-panel`, the card and every tone-carrying panel that is a
  card's sibling) · pill 999 (`rounded-full`). Inset shares the control rung, so there are two
  radii and a capsule. Reef's ladder was 10 · 18 · 28. Tailwind's own `rounded-xl` (12) and
  `rounded-2xl` (16) are not rungs. `card.test.tsx` refuses less than that sounds: `rounded-2xl`
  on a class string that also spells a panel's `border-border bg-surface`, `shadow-sm` on any
  `rounded-panel` string, and any `rounded-lg`/`xl`/`2xl`/`3xl` on `SectionCard` itself. A
  `rounded-xl` inset elsewhere passes (#1965).
- **Nested corners are derived, not picked.** A box painted near a rounded ancestor's corner takes
  the ancestor's radius less the inset between them, spelled from the same tokens so the two move
  together ([pixel-craft.md](pixel-craft.md), class 6): `SEGMENT_CORNER` in `ui/segmented.ts` for
  anything on a segmented track (12 − 1 − 4 = 7), `PANEL_INNER_RADIUS` in `ui/card.tsx` for a fill
  flush inside a card that does not clip (20 − 1 = 19), on the corners it touches. These two are
  the only radii off the ladder. A header menu's panel is `MENU_PANEL` in `ui/menu.ts`, which
  takes the segmented track's inset on purpose so its rows take `SEGMENT_CORNER` too. A menu whose
  rows can carry a tick (the identity menu, the language picker) starts every row's words and its
  group label on one gutter, `MENU_TICK_GUTTER`, and `menuRowClass` draws those rows.
- **Buttons**: `md` is **48px tall with a 16px label**, the sheet's default; `sm` stays 44/14 for a
  table row or a chip row; `icon` is a 48px square; `boat` stays the 56px dock target. The base's
  `min-h-11` is still the floor every size clears.
- **Text controls**: 16px type at every size. `field` is 44px (`controlClass`), for a stacked
  field with no button on its line; `md` is 48px (`controlClassFor("md")`, `SearchField size="md"`),
  for a control on one line with `md` buttons. Each size carries its own vertical padding, so the
  content box is 26px at both.
- **Rows**: a `LedgerRow` is never tighter than **52px** (`md`); `lg` is 56. Every row, door or
  not, keeps 8px of room each side of its words and runs its rules 8px past the column with it, so
  every ledger on a page draws its rules at one length; a skeleton or a hand-set line among ledger
  rows takes `ledgerRowBoxClass` (`src/components/ui/ledger.tsx`).
- **The ⌘K cap** belongs to the command palette's trigger in the header, not to `SearchField`: a
  real `<input>` does not advertise a global shortcut it does not own. The sheet drew them as one
  field; the split is deliberate.
- **`Field`'s `hint` vs `description`**: the sheet's "On the back of the card, under the name" is
  the *below* slot, which is `description`; `hint` rides inline inside the label.

## A box for a paragraph: `textareaClassFor`

A `<textarea>` wears `textareaClassFor(rows)`, never `controlClass`, and passes the same number as
its own `rows`. It grows with its text (`field-sizing: content`) and never stands shorter than
`rows` lines, which is also what a browser without `field-sizing` draws. A fixed box scrolled a
longer answer inside itself and showed its next line as a sliver on the bottom border — the course
FAQ answer, 1,200 characters in three rows, with a fourth line's ink 2px above the border at 390.
`form.test.tsx` refuses a textarea on `controlClass`, and one whose minimum disagrees with its
`rows`.

## Searching a list: `SearchField`

A staff list that can be searched renders **one search box and nothing around it** —
`SearchField` in `src/components/ui/form.tsx`: a `type="search"` control wearing `controlClass`, a
magnifier in its leading inset, its label `sr-only`, no caption above it and no "Search" button
beside it. A form with one text control submits on Enter; surfaces that want type-to-apply drive
`requestSubmit()` from `onInput`, as the orders toolbar and the counter do. A box that shares its
line with an `md` button, as the roster's and the seat-diver picker's do with "Add diver", passes
`size="md"` and stands at the button's 48px.

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
is a toolbar control, and the glyph is what says so. **There is no exception left.** The seat-diver
picker (`PersonSearchForm`) was the last one — a visible "Find a returning diver" caption, a bare
box, and a secondary Search button standing beside the band's own primary, which on a 390px phone
wrapped the caption onto two lines and left the box about 130px wide. It wears `SearchField` as of
issue #1230; Enter submits the GET form before and after hydration, which is all the button did,
and "Add diver" is the band's one primary again.

## Date entry: `DateField`

A date is entered through **`DateField`** in `src/components/ui/form.tsx`, never a bare `<input type="date">`. It is a `type="date"` control wearing `controlClass` with a calendar glyph in its trailing inset, and it goes inside a `Field` like any other control.

So are a month, a time and a date-and-time: `type="month" | "time" | "datetime-local"` (a time draws a clock). Spelled bare they kept the platform's solid black indicator beside a date box's muted outline, and iOS paints nothing in an empty one; `form.test.tsx` refuses a bare temporal `<input>` anywhere else. `size="md"` stands one on a line with `md` buttons, as `controlClassFor("md")` does.

An empty one looks empty. No temporal box matches `::placeholder`, so its `mm/dd/yyyy` mask drew in the ink of a filled answer beside muted placeholders; the input `DateField` renders is `DateInput` (`src/components/ui/DateInput.tsx`), a client leaf that marks itself `data-empty` while it holds no value, and `globals.css` paints `input[data-empty]::-webkit-datetime-edit` in the placeholder's colour.

```tsx
import { DateField, Field } from "@/components/ui/form";

<Field label={t("gear.serviceDueLabel")}>
  <DateField name="nextDueOn" min={today} required />
</Field>
```

The glyph is ours because the platforms disagree about whether an empty date box shows anything at all. Chromium paints `mm/dd/yyyy` **and** its own calendar indicator; iOS Safari paints neither, so an empty date field there is a blank rounded rectangle indistinguishable from the text boxes stacked above it, with nothing saying a tap opens a picker (issue #1415, reported on an iPhone against the date-request form).

Chromium's own indicator is hidden with `opacity-0`, never `display: none`. Hidden by opacity it stays in the layout underneath ours, so a Chromium tap on that spot still opens the native picker; removing it would take the tap target away with the pixels and leave our glyph looking live and doing nothing. The input's `pe-9` and the glyph's `end-3` are sized against each other for the same reason — drift them apart and the visible glyph stops sitting over the real control.

Firefox draws a calendar icon of its own and exposes no pseudo-element that reaches it, so a Firefox reader sees two glyphs. Known and accepted: the only alternative is sniffing the browser in JavaScript to hide ours, which costs more than the duplicate.

`DateField` is a composite control that `Field` treats as a native one, alongside `ForgivingInput` — it forwards `id`, `required` and the aria attributes onto the input it renders, so the caption reaches it by id and the required marker reads its `required`. A composite control added without joining that set in `Field`'s `isControl` silently loses its `*` and its `aria-describedby` wiring, which is what happened to "Full name" when that box became forgiving.

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
which reads as a layout bug rather than a menu. The "More" menu in `ShopNavLinks.tsx` that taught
this left with the nav of nouns (ADR 20260919-one-idea, slice 23b). The two menus in the staff
chrome now are `ShopPlaceMenu` in `src/components/ShopPlaceNav.tsx` (the three places, folded
behind one button below `lg`, read from `src/lib/staff-destinations.ts`) and
`src/components/ShopIdentityMenu.tsx` (settings, language and sign-out). Both are one column. Both
keep a row on one line with a panel minimum width (`min-w-40`, `min-w-44`) rather than
`whitespace-nowrap` on the row, which holds only while every label fits that width.
