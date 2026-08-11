# FU-20260811-buddy-team-row-composition — Rework a buddy team's own row: the far-flung "Dissolve team" and the required-marked "Add to this team"

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/manifest-dropdown-ui-jf6mih`, a manifest polish pass that
  fixed the buddy panel's *header* (caret alignment, the triple-stated empty state) but left the
  rows underneath it alone
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/BuddyTeamsPanel.tsx`,
  `src/components/ui/form.tsx`, `e2e/visual.spec.ts`

## What I noticed

Open the buddy panel on a departure that has teams
(`/shop/blue-mantis/trips/<id>/manifest`, "Buddy teams", any trip the seed gives teams to — the
Two-Tank Reef charter has two). Each team's row is one `justify-between` flex line, so:

- **"Dissolve team" sits at the row's far right edge**, aligned to nothing. At a 1280 viewport that
  is roughly 500px of empty space between "TEAM 01 / Lena Fischer, Tom Okafor" and the destructive
  button that dissolves it. This change bounded the list at `max-w-4xl` so it stops running to the
  edge of a wide monitor, which helps above ~1000px of content width and does nothing below it.
  The button is still not visually attached to the team it acts on.
- **"Add to this team" wears a red required asterisk** on every team row. It comes from `Field`'s
  standard required marker and it is correct in the sense that the `<select>` is `required` — but
  this is a one-field form whose submit button is "Add", and there is nothing else on the row to
  distinguish from. Two or three teams open puts two or three red asterisks into a panel whose only
  real warning colour ("Dissolve team", `danger-ghost`) is trying to mean something.

Neither is wrong; both make a calm panel read busier than the decision it holds.

## Why it isn't already done

Outside the scope I was given. The session was asked about the *dropdowns* — the diver rows'
disclosures and the buddy panel's own summary line — and both of those are now fixed. Changing how a
team row composes is a design call with more than one defensible answer (does "Dissolve team" become
a trailing item on the members line? a quieter link under "Recorded by"? does it stay put and the
row simply get narrower?), and it moves pixels in `manifest-buddy-teams-panel`, so it deserves to be
its own reviewed change rather than a drive-by inside a copy-and-alignment pass.

The asterisk half also is not purely local: `Field`'s required marker is shared by every form in the
staff app, so "drop it here" needs to be either a deliberate per-call opt-out or an argument that
one-field forms never need it.

## Proposed change

1. Bring "Dissolve team" back to the team it dissolves. The straightforward version: stop using
   `justify-between` on the team row and let the dissolve form follow the members/recorded-by block
   as a trailing item with its own `gap`, so it reads as belonging to that team rather than to the
   panel's right margin. Keep `danger-ghost` — the quiet treatment was a deliberate 20260810 review
   outcome and this is not a reason to reopen it.
2. Decide the asterisk. Either give `Field` an opt-out for a single-required-field form and use it
   here, or leave the marker and accept it. Do **not** drop `required` from the `<select>` — the
   server refusal it pairs with is real.
3. Re-run and explain `manifest-buddy-teams-panel` (light and dark). Its baseline moves either way.

Not proposed: turning the per-team "add a member" picker into a disclosure. It is already one line
at rest and folding it would put a fold in front of the panel's most-used action.

## Prompt

```text
Rework the buddy team row on the boat manifest so its controls belong to the team they act on.

Read first:
  src/app/shop/[shopSlug]/trips/[id]/manifest/_components/BuddyTeamsPanel.tsx (the buddyTeamsList
    <ul> and the per-team <li>)
  src/components/ui/form.tsx (Field, and how it renders the required marker)
  docs/design/forms-and-controls.md
  docs/product/follow-ups/FU-20260811-buddy-team-row-composition.md (this file)

Two things to fix, both visible by opening "Buddy teams" on
/shop/blue-mantis/trips/<id>/manifest for the seeded Two-Tank Reef charter:

1. "Dissolve team" is pushed to the row's far right by `justify-between`, leaving ~500px of gap
   between a team and the button that dissolves it. Make it read as that team's control. Keep the
   `danger-ghost` variant — its quietness was a deliberate design-review outcome (see the comment
   above the form), so this is a placement change, not a tone change.
2. Every team row shows "Add to this team *" — Field's required marker on a one-field form, several
   red asterisks deep in a panel whose only meaningful warning colour is the dissolve button. Either
   add a deliberate opt-out to Field and use it here, or write down why the marker stays. Do NOT
   remove `required` from the <select>; the server refusal it pairs with is real.

The constraint that makes this non-obvious: a team can hold many members, so the members list wraps
freely and any layout that assumes one short line will break on a team of five. And the panel is
`print:hidden`, so nothing here shows on the paper the boat carries — this is a screen-only call.

Done when: the dissolve control is visually attached to its team at 390 and 1280; the asterisk
question is resolved one way with a comment saying which; `pnpm check` is green; and
`pnpm e2e:run e2e/visual.spec.ts --reporter=line -g "buddy-team builder"` passes, with the
manifest-buddy-teams-panel diff explained in the PR (light and dark).

Delete docs/product/follow-ups/FU-20260811-buddy-team-row-composition.md as part of the change.
```
