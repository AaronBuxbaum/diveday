# FU-20260821-blockers-empty-and-truncated-states-have-no-capture — Give the by-departure view's empty and truncated states a visual capture, or write down why they don't get one

- **Status:** Open
- **Raised:** 2026-08-21 — PR #595, the copy-restraint sweep over the last four staff bundles
- **Kind:** risk
- **Effort:** M
- **Touches:** `e2e/visual.spec.ts`, `scripts/route-coverage.json`, `e2e/fixtures.ts`, `src/app/shop/[shopSlug]/_components/BlockerGroups.tsx`, `src/i18n/locales/en-US/staff/blockers.json`, `docs/architecture/decisions/20260815-per-test-private-shops.md`

## What I noticed

PR #595 deleted `blockers.emptyDescription` and reworded `blockers.truncated`, both rendered by
`src/app/shop/[shopSlug]/_components/BlockerGroups.tsx` — the shop home's by-departure view,
reached at `/shop/<slug>?view=departures`. The visual suite reported 30 changed surfaces for that
PR and **not one of them was `blockers`**. That is not evidence the two edits were safe. It is
because neither string renders in any capture at any width: the `blockers` baseline is shot against
the seeded `blue-mantis` demo shop, whose queue always has blocked divers, so the `trips.length === 0`
branch that holds the empty state never runs; and `truncated` is only true when a shop has more than
`OPERATIONAL_MAX_TRIPS` (60, `src/lib/operational-window.ts`) departures *all* sitting inside the
operational horizon, which the demo shop does not have either. Both edits in #595 were therefore
verified by reading the component, never by looking at pixels.

The consequence is forward-looking rather than about that PR. Those two states have no capture at
all, so the next change that breaks one of them — an empty state whose heading and button collide
after a spacing edit, a truncation line that silently stops rendering when the cap moves, a
`<p>` removed and its wrapper left behind — ships with a fully green visual suite and nobody
notices until a shop with a quiet week or a very busy one opens the page.

## Why it isn't already done

It was out of scope for a copy-deletion PR, and more importantly the seeding question is a real
decision that I did not want to make on someone else's behalf. Three routes, with what each costs:

**(a) Extend the existing `today-empty` test.** `e2e/visual.spec.ts` already onboards a brand-new
shop through `/onboard` and captures the shop home's *urgency* view empty state ("Nothing is waiting
on you"). A freshly onboarded shop has zero departures, and `BlockerGroups` renders its `EmptyState`
whenever `trips.length === 0`, so one extra navigation to `?view=departures` and one more `capture()`
in that same test would plausibly cover the empty state for near-zero runtime. What I have **not**
verified, and whoever takes this must: that the by-departure view renders sensibly on a shop with no
trips whatsoever, and that the first-run onboarding checklist above it does not dominate the frame
and make the capture about something else.

**(b) A purpose-seeded private shop.** The `privateShop` fixture in `e2e/fixtures.ts` mints a fully
seeded shop and signs in as its owner (ADR `20260815-per-test-private-shops`), so a test can empty or
overfill that shop's queue without touching `blue-mantis` and without leaking state into whichever
spec the worker runs next. It costs roughly three seconds per test, but it is the sanctioned door for
anything that needs shop-wide state.

**(c) Not `/api/test/seed-trouble-states`.** That route exists for panels that only render when
something has gone wrong — stuck payments, owed erasures, unfinished media deletions. An empty
readiness queue is the opposite of a trouble state: it is a shop with nothing waiting on it, which is
the good outcome. Adding it there would stretch the route past the thing it is for, so I would rule
this one out unless a reviewer disagrees.

The two states also are not equally cheap, which is the part that most deserves a human's call. The
empty state may fall out of (a) almost free. `truncated` does not: reproducing it means seeding more
than sixty departures inside the horizon, which is a slow fixture for one line of text. It may be
right to cover the empty state now and leave `truncated` deliberately uncovered with the reason
recorded, rather than paying that seed. I lean to (a) plus splitting `truncated` off, but I am not
confident enough in the unverified assumption above to call it settled.

## Proposed change

Pick a route, then add the capture in `e2e/visual.spec.ts` beside the existing `blockers` one,
register every new capture name in `scripts/route-coverage.json` under the `/shop/[shopSlug]` entry's
`visual` list (the lists are hand-maintained and `pnpm check:route-coverage` reads them), and let the
merge bank the new baseline in S3 — there is nothing to commit locally. If `truncated` is deliberately
left uncovered, say so in a comment beside the `blockers` capture naming the cost, so the next reader
does not re-derive this.

Explicitly **not** proposed: seeding an empty or overfull queue into `blue-mantis` itself, since it is
the demo shop and a demo whose board is blank is a worse demo; and narrowing the existing populated
`blockers` capture with a filter to make room, which trades away what that capture already catches.

## Prompt

```text
The shop home's by-departure view (/shop/<slug>?view=departures, rendered by
src/app/shop/[shopSlug]/_components/BlockerGroups.tsx) has two states with no visual capture at
all: the EmptyState shown when trips.length === 0, and the `truncated` line shown when a shop has
more than OPERATIONAL_MAX_TRIPS (60, src/lib/operational-window.ts) departures inside the
operational horizon. The seeded blue-mantis demo shop hits neither, so the existing `blockers`
baseline in e2e/visual.spec.ts only ever photographs the populated view, and a regression in
either state ships green.

Read first: src/app/shop/[shopSlug]/_components/BlockerGroups.tsx, the `blockers` and `today-empty`
captures in e2e/visual.spec.ts, e2e/fixtures.ts (the `privateShop` fixture), and
docs/architecture/decisions/20260815-per-test-private-shops.md.

The constraint that makes this non-obvious is which shop to shoot. Do NOT seed an empty queue into
blue-mantis, and do NOT use /api/test/seed-trouble-states — that route is for panels that render
only when something has gone wrong, and an empty queue is the opposite. The two candidates are
extending the existing `today-empty` test, which already onboards a fresh shop through /onboard and
would need only a second navigation to ?view=departures, or minting a `privateShop`. Verify before
committing to the first that the by-departure view renders sensibly with zero trips and that the
first-run checklist above it does not take over the frame. Covering the empty state and
deliberately leaving `truncated` uncovered is an acceptable outcome if you write the reason in a
comment beside the `blockers` capture.

Done when: the new capture(s) exist in e2e/visual.spec.ts, every new capture name is listed in
scripts/route-coverage.json under /shop/[shopSlug], `pnpm check` is green, and a filtered run
(`pnpm e2e:build` then `npx playwright test e2e/visual.spec.ts -g "<your test title>"
--reporter=line`) produces the PNGs and you have looked at them in light and dark. Baselines live
in S3 keyed by commit, so there is nothing to regenerate or commit locally — merging is what banks
them. Delete
docs/product/follow-ups/FU-20260821-blockers-empty-and-truncated-states-have-no-capture.md as part
of the change.
```
