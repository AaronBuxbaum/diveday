# FU-20260810-manifest-summary-pins-behind-nav — The roll-call summary panel pins behind the shop nav on tablets

- **Status:** Open
- **Raised:** 2026-08-10 — branch `claude/product-folder-followups-qnppkp`, while giving the schedule
  board's day headers a sticky offset (FU-20260810-board-sticky-day-headers)
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/SummaryPanel.tsx`,
  `src/app/globals.css`, `e2e/roll-call.spec.ts`

## What I noticed

The manifest's roll-call summary — the panel that says how many divers are still to be counted — is
`sticky top-20` (80px). The staff shell's header (`src/components/ShopNav.tsx`) is itself
`sticky top-0`, and it has no fixed height: it wraps into one, two, or three rows depending on
width. Measured on the schedule board at every width from 360px to 1280px, it is **169px** below
640, **121px** from 640 to 1023, and **69px** from 1024 up.

So `top-20` only clears it on a desktop. Measured directly on
`/shop/blue-mantis/trips/<id>/manifest`, scrolled 700px down:

| Viewport | Nav bottom | Panel top | Clearance |
| --- | --- | --- | --- |
| 390px | 169px | 211px (still flowing, not yet pinned) | — |
| 768px | 121px | 80px | **−41px** |
| 1280px | 69px | 80px | +11px |

At tablet widths the panel pins 41px underneath the nav, so its top strip — which is where the
"N still to call" heading sits — is covered while a staffer scrolls the roster. On a phone the panel
is far enough down the page that it had not pinned at that scroll depth, but it has the same 80px
offset against a 169px nav, so it is covered there too once the page is long enough to pin it.

This is a roll-call surface, which is why it is filed as a risk rather than a polish item: the whole
point of pinning that panel is that the count stays readable while the crew works down the list.

## Why it isn't already done

It is a different page from the one I was asked to change, and it is safety-adjacent — AGENTS.md
routes manifest and roll-call work through a `dive-domain-expert` review, which a drive-by fix at
the end of an unrelated change would skip. It also wants its own screenshot round at all three
widths, in light and dark, with roll call both open and complete (the panel has two skins).

The fix itself is now cheap, which is the other reason to file rather than leave it: the board work
introduced `--staff-nav-h` in `src/app/globals.css`, a measured, breakpoint-aware value for exactly
this height, guarded by an assertion in `e2e/schedule-builder.spec.ts` that fails if the nav's shape
changes.

## Proposed change

In `SummaryPanel.tsx`, replace both `sticky top-20` occurrences with
`sticky top-[var(--staff-nav-h)]`, and add the equivalent of the board's guard to
`e2e/roll-call.spec.ts`: at 390px, 768px, and 1280px, scroll until the panel is pinned and assert its
top is at or below the nav's bottom.

Then sweep the rest of the app for the same family of bug: `scroll-mt-24` (96px) appears on a dozen
staff surfaces with the comment "keeps the row clear of the sticky shop header", and 96px is short of
the nav's 121px and 169px shapes too — so a deep link or a focus jump on those pages lands the target
partly under the nav at anything below 1024px. Those are `scroll-margin`, not `top`, so they are a
separate (and less severe) fix; do not fold them into this one without checking each call site,
because some of them are inside boat-mode surfaces where the nav is not present at all.

Not proposing to make the nav a fixed height instead. Its height is content-driven (shop name,
search, role switcher), and pinning it would clip a long shop name at some width nobody tested.

## Prompt

```text
Fix the DiveDay manifest's roll-call summary panel pinning behind the staff nav at tablet and phone
widths.

Read first: src/app/shop/[shopSlug]/trips/[id]/manifest/_components/SummaryPanel.tsx (the two
`sticky top-20` class strings), src/components/ShopNav.tsx (the `sticky top-0 z-30` header), and the
`--staff-nav-h` block in src/app/globals.css including its comment.

The bug: the panel's 80px offset is a guess that only clears the nav on a desktop. The nav wraps to
121px between 640 and 1023px and 169px below 640, so at 768px the panel pins 41px *underneath* it and
the "still to call" heading is covered while the crew scrolls the roster. Measured, not inferred —
the numbers are in docs/product/follow-ups/FU-20260810-manifest-summary-pins-behind-nav.md.

Do this: swap both `top-20` occurrences for `top-[var(--staff-nav-h)]`, then add a guard to
e2e/roll-call.spec.ts modelled on the "a pinned day header sits below the shop nav, not behind it"
test in e2e/schedule-builder.spec.ts — at 390px, 768px and 1280px, scroll until the panel is pinned
and assert its top is at or below the nav's bottom.

Constraints: this is a roll-call surface, so get a dive-domain-expert review before merging, and look
at the result in light and dark at all three widths with roll call both open and complete — the panel
has two different skins (`rise-in` when complete). Do not give the nav a fixed height instead; it is
content-driven and would clip a long shop name.

Run `pnpm check` and `pnpm e2e roll-call.spec.ts --reporter=line`. Delete
docs/product/follow-ups/FU-20260810-manifest-summary-pins-behind-nav.md as part of the change.
```
