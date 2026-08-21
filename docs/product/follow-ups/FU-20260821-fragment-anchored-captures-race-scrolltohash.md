# FU-20260821-fragment-anchored-captures-race-scrolltohash — Make a `#fragment` visual capture land at a deterministic scroll position

- **Status:** Open
- **Raised:** 2026-08-21 — PR #585, seen on CI run 32441820119
- **Kind:** risk
- **Effort:** S
- **Touches:** `e2e/visual.spec.ts`, `src/components/ScrollToHash.tsx`

## What I noticed

`trip-guests-deal-seeded-light-vw-390.png` reported a visual difference on one commit of PR #585
and none on the two either side of it, on a branch whose diff is a test comment, a `setTimeout`
value and two markdown files. No product code, so nothing about that surface changed.

I pulled the images (`pnpm visual:report --commit fa9bea930a71b1a6bd69b67686b4ac3c84786f21`). The
**content is identical** — same divers, same order, same text, same discount. What moved is the
page's *fixed chrome*:

| | Shop header ("Blue Mantis Divers") | Staff dock (Today / Check-in / …) |
| --- | --- | --- |
| expected | at the top of the image | painted ~a fifth of the way down |
| actual | painted ~half way down | at the bottom of the image |

That is one page photographed at two different scroll positions, not two different pages.

The mechanism is a race between two things that both want to set the scroll:

- The capture navigates to `/shop/blue-mantis/trips/<id>/guests#last-minute-deal`, waits for the
  text `Open Water — unconfirmed`, then calls `capture()` → `paintWholeDocument()`, which scrolls
  the whole document to force lazy paints and finishes with `window.scrollTo(0, 0)`
  (`e2e/visual.spec.ts`).
- `ScrollToHash` (`src/components/ScrollToHash.tsx`) runs `useEffect` on mount and does
  `target.scrollIntoView({ block: "start", behavior: "instant" })` for that same fragment.

Whichever lands last decides where the fixed bars paint into the stitched full-page screenshot. The
text gate proves the content rendered; it proves nothing about hydration having run, so the effect
can fire either side of the reset.

Only fragment-anchored captures can hit this, which is why it is rare and why it reads as noise.

## Why it isn't already done

It surfaced on PR #585, whose whole subject was a *different* e2e reliability failure, and whose
diff deliberately touches no product code. Widening it to change the shared `capture()` helper —
which every one of 520 baselines runs through — was not the change to make while un-redding `main`.

It also cannot be verified locally in the usual way: baselines live in S3 keyed by commit (ADR
20260729-reg-suit-visual-regression), so proving a capture is now stable means pushing and watching,
not running something here.

## Proposed change

Make the scroll position at screenshot time deterministic rather than whoever-wins.

Preferred: in `paintWholeDocument`, after the final `window.scrollTo(0, 0)`, wait two animation
frames and re-assert `window.scrollY === 0`, scrolling again if a late effect moved it. That is
narrow, lives in the helper every capture already shares, and needs no per-test knowledge of which
surfaces carry a fragment.

Alternative, if that proves flaky: have fragment-anchored captures wait on a hydration marker before
capturing, the way the booking form's `data-hydrated` attribute is waited on elsewhere in `e2e/`,
so `ScrollToHash` is guaranteed to have already run.

**Not** proposed: changing `ScrollToHash` itself. It is correct — a Next `<Link>` transition does
not run the browser's fragment navigation, and this is what closes that gap for a real staff member
following a link to `#last-minute-deal`. This is the capture's problem, not the product's.

Also **not** proposed: masking the sticky chrome out of the capture. It is real UI a shop sees, and
AGENTS.md is explicit that a moving element is stabilised at the harness boundary, never hidden.

## Prompt

```text
Make visual captures of pages opened at a `#fragment` land at a deterministic scroll position.

Read `paintWholeDocument` and `capture` in e2e/visual.spec.ts, then src/components/ScrollToHash.tsx.
The bug: `paintWholeDocument` scrolls the document to force lazy paints and ends with
`window.scrollTo(0, 0)`, while ScrollToHash's mount effect scrolls back to the fragment with
`scrollIntoView({ block: "start", behavior: "instant" })`. Whichever lands last decides where
`position: fixed` chrome (the shop header and the staff dock) paints into the stitched full-page
screenshot, so `trip-guests-deal-seeded` intermittently diffs with identical content — see the
images under .reg-report/fa9bea930a71b1a6bd69b67686b4ac3c84786f21/ if that commit's report is still
in S3, or reproduce by re-running the capture.

Fix it in the shared helper: after the final scrollTo(0, 0), wait two animation frames and
re-assert window.scrollY === 0, scrolling again if a late effect moved it. Do NOT change
ScrollToHash — it is correct product behaviour for a staff member following a link to
#last-minute-deal. Do NOT mask the sticky chrome out of the capture.

Done when: the helper cannot screenshot a page that a late effect has scrolled, and
`trip-guests-deal-seeded` is stable across three consecutive CI runs (baselines are in S3 keyed by
commit, so this is verified by pushing and watching, not locally). Run `pnpm check` and
`pnpm e2e e2e/visual.spec.ts --reporter=line`. Delete
docs/product/follow-ups/FU-20260821-fragment-anchored-captures-race-scrolltohash.md as part of the
change.
```
