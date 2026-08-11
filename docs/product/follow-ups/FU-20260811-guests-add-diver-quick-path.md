# FU-20260811-guests-add-diver-quick-path — Give the roster header a one-tap way into "Add a diver"

- **Status:** Open
- **Raised:** 2026-08-11 — the Guests/Overview recomposition (branch `claude/app-design-overhaul-x8gygb`)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx`, `src/app/shop/[shopSlug]/trips/[id]/guests/page.tsx`

## What I noticed

The Guests tab now leads with the roster (the page's answer — "who is attending") and the
Add-a-diver section follows it, reachable by scrolling or by the `#add-diver` anchor the empty
state and seat-refusal redirects already use. On a busy walk-in morning with a ten-card roster,
a staffer standing at the counter with a diver in front of them has to scroll past the whole
list to reach the add form — the old layout put the form first, which was wrong for the common
read case but faster for that write case.

## Why it isn't already done

The roster header already carries the filter chips and the bulk waiver-send control; adding a
third control there needed more thought than the recomposition's scope allowed (principle 8 —
fewer controls, one obvious action — cuts against stacking another button in that row without
deciding what it displaces). The counter walk-in flow at `/shop/[shopSlug]/check-in` also exists
for exactly this moment, so the right answer may be "nothing".

## Proposed change

If real usage shows staff reaching for Guests to seat walk-ins, add one quiet anchor link
(`#add-diver`, `buttonClass({ variant: "ghost", size: "sm" })`) in the roster's header row,
rendered only when `canAddDivers` and the roster is non-empty (the empty state already carries
its own door). Not proposing: moving the form back above the roster, or a sticky action bar —
both re-invert the page's answer-first order.

## Prompt

```text
Read docs/design/principles.md (#8, #10) and
src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx, then decide whether the
Guests tab's roster header should carry a small anchor link to the #add-diver section further
down the page (rendered only when canAddDivers && roster.length > 0). The constraint that makes
this non-obvious: the header row already holds the filter chips and the bulk waiver-send
control, and the check-in surface already serves the counter walk-in moment — so first confirm
the link earns its place rather than duplicating a door. If you add it, keep one primary action
on the page, take fresh light+dark screenshots of the Guests tab, and run pnpm check plus
pnpm e2e:run add-diver.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260811-guests-add-diver-quick-path.md as part of the change.
```
