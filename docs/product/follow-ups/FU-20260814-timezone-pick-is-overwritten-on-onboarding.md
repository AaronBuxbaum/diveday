# FU-20260814-timezone-pick-is-overwritten-on-onboarding — A shop that picks its own timezone during sign-up does not keep it

- **Status:** Open
- **Raised:** 2026-08-14 — bisecting the red `Playwright shard 3/4` on PR #535. Split out of
  FU-20260813-visual-and-functional-specs-share-one-database once it turned out **not** to be a
  shared-state problem at all.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/components/DetectTimezone.tsx`, `src/app/onboard/page.tsx`,
  `e2e/onboard.spec.ts`

## What I noticed

`e2e/onboard.spec.ts:65` — "a shop outside the curated dive regions can pick its own timezone" —
**fails on its own**, deterministically, with nothing else running:

```
Error: expect(locator).toHaveValue(expected) failed
Locator:  locator('select[name="timezone"]').filter({ visible: true })
Expected: "Asia/Jayapura"
Received: "America/New_York"
  20 × locator resolved to <select … name="timezone" id="shop-timezone" data-zone-detected="true" …>
     - unexpected value "America/New_York"
```

The spec waits for the `All timezones` optgroup to be attached, selects `Asia/Jayapura`, and the
select is still holding `America/New_York` eight seconds later. `selectOption` itself did not throw,
so the option existed and the pick was made — and then reverted.

**This is a product bug, not a test bug.** A shop signing up from anywhere the device zone is not
their shop's zone — a Raja Ampat operator whose laptop is still on US Eastern, an owner setting up
from a trip — picks their zone, and the form quietly puts it back. Every date and time on every
DiveDay surface renders in `shops.timezone`: the board's day headers, "sailing today", a departure's
08:30. `DetectTimezone`'s own docblock is explicit that this is the wrongness it exists to prevent
("a schedule quietly reading in somebody else's zone, which is the kind of wrongness you only notice
weeks later when a departure time is hours off") — and the sign-up path currently produces exactly
that for anyone who *does* answer the question.

## Why it isn't already done

Found while bisecting something else, and it needs a diagnosis I did not finish rather than a patch
I could guess at.

`DetectTimezone` looks correct in isolation: it runs once, guards on `dataset.zoneDetected`, and its
`detect` prop is false whenever a value has already been chosen. The `data-zone-detected="true"` in
the failure means it had already run *before* the pick, so the naive story — "the effect fires late
and clobbers the user" — does not fit as written. Two candidates I did not separate:

1. **A re-render replaces the option list.** If the `All timezones` optgroup arrives (or React
   reconciles the `<select>`) after the pick, an uncontrolled select re-rendered with its
   server `defaultValue` resets to `America/New_York`. That would fit the evidence exactly, and
   would mean the bug is the picker's rendering rather than `DetectTimezone` at all.
2. **The effect runs twice.** `dataset.zoneDetected` lives on the DOM node, so a remount that
   creates a *new* node clears the guard, and the second run re-applies the device zone over the
   pick.

Both are cheap to tell apart with the trace already produced by the failing run.

Worth noting for whoever picks this up: `e2e/onboard.spec.ts` is not new, so this is not a recent
regression in the spec. Either the product changed under it or it has been red on main for a while
— check `git log` on both files before assuming.

## Proposed change

1. Separate the two candidates above from the Playwright trace
   (`pnpm exec playwright show-trace` on the failing run's `trace.zip`).
2. Fix the cause. If it is (1), the select needs to keep the user's value across the re-render —
   which is a real fix a real shop benefits from, not a test accommodation. If it is (2), the guard
   needs to survive a remount (module-scoped or ref-based, not `dataset`).
3. Keep the spec's assertion exactly as it is. It is asserting the right thing: a zone the user
   picked is the zone the form holds.
4. Check the same picker in Settings (`src/app/shop/[shopSlug]/settings/SettingsPage.tsx`), which
   mounts `DetectTimezone` too. If the cause is a remount or re-render, that surface has it as well,
   and there the value being overwritten is a shop's *existing* configured zone.

**Not proposed:** relaxing the assertion, retrying the selection, or waiting longer. The value went
back on its own; a longer wait just observes it for longer.

## Prompt

```text
A shop that picks its own timezone during sign-up does not keep it. Fix the cause.

Reproduce (fails alone, no sharding needed):
  pnpm e2e:build
  pnpm e2e:run e2e/onboard.spec.ts --reporter=line --workers=1
Expect "a shop outside the curated dive regions can pick its own timezone" to fail: the select is
asked for Asia/Jayapura and is still holding America/New_York eight seconds later, with
data-zone-detected="true" already on the element.

Read first:
  - docs/product/follow-ups/FU-20260814-timezone-pick-is-overwritten-on-onboarding.md (this file --
    its "Why it isn't already done" section names the two candidate causes and why the obvious
    story does not fit)
  - src/components/DetectTimezone.tsx -- the whole file, including the docblock, which explains
    what it is guarding and why it must never overwrite an answer someone gave
  - src/app/onboard/page.tsx -- how the select and its optgroups are rendered
  - e2e/onboard.spec.ts around line 65
  - the debug skill

The constraint that makes this non-obvious: `data-zone-detected="true"` is already set when the
pick is made, so DetectTimezone had already run and its guard was already tripped. The naive
"the effect fires late and clobbers the user" story does NOT fit. Separate the two candidates from
the Playwright trace before changing anything: a re-render resetting an uncontrolled select back to
its server defaultValue, versus a remount creating a fresh DOM node that clears the dataset guard.

This is a product bug. Do not relax the assertion, add a retry, or wait longer -- the value reverted
on its own, so a longer wait only watches it revert. And check
src/app/shop/[shopSlug]/settings/SettingsPage.tsx, which mounts the same component: if the cause is
a remount or re-render, a shop's already-configured zone is being overwritten there too, which is
worse than the sign-up case.

Done when: pnpm e2e:run e2e/onboard.spec.ts passes, the Settings picker is confirmed unaffected or
fixed with it, a regression test covers whichever cause it was, and `pnpm check` is green. Delete
docs/product/follow-ups/FU-20260814-timezone-pick-is-overwritten-on-onboarding.md as part of the
change.
```
