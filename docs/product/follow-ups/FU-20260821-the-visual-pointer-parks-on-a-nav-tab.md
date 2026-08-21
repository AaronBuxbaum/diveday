# FU-20260821-the-visual-pointer-parks-on-a-nav-tab — Park the mouse before every visual capture

- **Status:** Open
- **Raised:** 2026-08-21 — triaging PR #593's visual diff (`claude/prep-group-by-item-8f3c2d`)
- **Kind:** risk
- **Effort:** S
- **Touches:** `e2e/visual.spec.ts`

## What I noticed

PR #593 touched one route, `/shop/[shopSlug]/trips/[id]/prep`. reg-suit reported **13** changed
surfaces: the twelve prep captures the change explains, plus
`trip-guests-identity-dark-vw-1280.png`, which is the Guests tab of a Night Dive departure and
shares no code with the change.

The whole of that thirteenth diff is **one pill in the staff header**. The current destination
("Board") renders `bg-primary/10 text-primary` in the new capture — `navClass(true)` in
`src/components/ShopNavLinks.tsx` — and `bg-surface-sunken`/`text-foreground` in the baseline, which
is that component's `hover:` pair. The baseline was photographed with the pointer resting on the
tab; the new run was not. The same pill in `prep-light-vw-1280.png` is byte-identical between
baseline and actual, so the styling itself did not move.

Nothing in the spec clicks that tab, and **the difference is demonstrably non-deterministic**. The
next commit on that same branch added one Markdown file and touched no code, no spec and no asset;
reg-suit's run over it reported **12** changed and 508 passed against the same baseline, with
`trip-guests-identity-dark-vw-1280` *passing*. So the capture flipped between two runs of a tree
that differs by a `.md` file, and it flips in both directions — the baseline and the second run
landed hovered, the first did not.

The leading explanation, **not yet proven**: `capture()` (`e2e/visual.spec.ts`) resizes the page to
390 and then to 1280 and calls `paintWholeDocument`, which scrolls the document through in
viewport-sized steps. Chromium recomputes `:hover` against a **stationary** pointer on both a resize
and a scroll, so whatever element ends up under the last click's coordinates picks up a hover state —
and for a test that ends on a click (this one ends on `openTripTab(page, "Guests")`), which element
that is depends on a layout the capture itself is changing underneath it. What would confirm it:
log `page.mouse` position and the `:hover` chain immediately before each `screenshotOrGiveUp`, over
a couple of runs of this one test.

Whatever the mechanism, a capture that can flip between hovered and unhovered from one run to the
next is the problem. It cost this PR a diff to explain that had nothing to do with it; the worse
case is the reverse — a hover state masking a real change, or a reviewer waving through a diff
because "that one is always noisy".

## Why it isn't already done

Outside the scope of the PR that surfaced it, and the fix touches the one helper every capture in
the suite goes through — a change that re-baselines whichever surfaces are currently sitting on the
hovered side of this coin, which cannot be predicted without running it. That deserves its own PR
whose whole diff is the re-baseline, rather than being buried in a feature change.

## Proposed change

In `capture()` (`e2e/visual.spec.ts`), move the pointer somewhere inert before the first
`setViewportSize` — `await page.mouse.move(0, 0)` is enough, since `(0, 0)` is the viewport corner
and no interactive element sits there on any surface in the suite. Do it once at the top of
`capture()`, not per viewport: the pointer does not move between the two, and the goal is only that
it is not over anything.

Expect a re-baseline of whichever surfaces are currently captured hovered. Read each one and say in
the PR that the only change is a nav pill or link losing a hover fill — a diff that shows anything
else is a real one hiding behind this cleanup.

**Not** proposed: masking hover states, or asserting `:hover` is absent. The state is real and worth
photographing deliberately somewhere; what is wrong is that it arrives by accident.

`capturePrint()` needs nothing — `emulateMedia({ media: "print" })` already drops hover styling.

## Prompt

```text
In the DiveDay repo, stop the visual suite photographing accidental hover states.

Read first: `capture()` and `paintWholeDocument()` in e2e/visual.spec.ts, and `navClass` in
src/components/ShopNavLinks.tsx.

The problem, with evidence: PR #593 touched only the trip prep route and reg-suit still reported
`trip-guests-identity-dark-vw-1280.png` as changed. The entire diff is the header's current-
destination pill rendering `hover:bg-surface-sunken hover:text-foreground` on one side and
`bg-primary/10 text-primary` on the other; heights identical, no other pixel on the page moved. The
next commit on that branch added a single Markdown file and the same surface *passed* — so it flips
between runs of a tree that differs by a `.md` file, in both directions.

Suspected mechanism, unproven: no spec clicks that tab, but `capture()` resizes the page 390 -> 1280
and `paintWholeDocument` scrolls it through, and Chromium recomputes `:hover` under a stationary
pointer on every resize and scroll — so a test that ends on a click leaves the cursor over whatever
the new layout puts beneath it.

Confirm the mechanism before fixing it: log the pointer position and the hovered element chain right
before each `screenshotOrGiveUp` and run that one test twice. If it holds, the fix is to move the
pointer off everything (`await page.mouse.move(0, 0)`) once at the top of `capture()`, before the
viewport loop. If it does not, say so and stop — a wrong fix here re-baselines the suite for nothing.

Done when the visual job is green and every re-baselined surface is accounted for in the PR body —
each one should differ only by a nav pill or link losing a hover fill. Anything else in a diff is a
real change that was hiding behind this, and must be explained rather than merged through. See the
visual-triage skill; baselines live in S3 and merging is what promotes them, so there is nothing to
regenerate locally.

Run: pnpm check, then a filtered visual run, then read the PR's reg-suit report.
Delete docs/product/follow-ups/FU-20260821-the-visual-pointer-parks-on-a-nav-tab.md as part of the
change.
```
