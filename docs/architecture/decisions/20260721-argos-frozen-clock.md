# 20260721-argos-frozen-clock — Stabilise Argos visual regression with a frozen clock, not masking

- **Status:** Accepted
- **Date:** 2026-07-21
- **Supersedes:** 20260721-argos-visual-regression

## Context

`20260721-argos-visual-regression` added Argos visual regression on ten key surfaces (landing,
sign-in, public schedule, the reef briefing, a course page, Today, the divers roster, a diver
profile, trip manage, boat manifest) in light and dark at a phone (390) and a desktop (1280)
viewport — 40 screenshots per run — and uploads only when `ARGOS_TOKEN` is set. That surface
decision stands. Its **stabilisation** did not: the demo seed is clock-anchored (one trip always
sails *today*, cert expiries are relative) and many surfaces render relative time, so against a
live clock every baseline diffed on nothing but the passage of time. The original answer was to
**mask** the moving time/date text, but a mask only hides a text box — it cannot stabilise the
layout shifts a moving clock actually causes (the Today queue reorders as a trip crosses from
upcoming to sailed, a rounded departure slot advances every half hour, a date rolls at midnight),
and it blinds the diff to real regressions inside the masked regions. Argos kept showing changes.

## Decision

Freeze the clock instead of masking, on both sides, so every render is a pure function of one
fixed instant:

- **A single clock seam.** `src/lib/clock.ts` exports `nowDate()` / `nowMs()`. All of `src/lib`
  and `src/db` — the clock-anchored seed and every query — read time through it; `pnpm check:clock`
  (`scripts/check-clock.mjs`, in `pnpm check`) forbids bare `new Date()` / `Date.now()` there. In
  production the seam is `new Date()` / `Date.now()` byte for byte; it is refused whenever a real
  `DATABASE_URL` is set, so it can never freeze a real deployment.
- **Server frozen by env.** The e2e fleet sets `DIVEDAY_CLOCK` (playwright.config.ts) to
  `E2E_FROZEN_CLOCK` (e2e/servers.ts), so the seed and every server render resolve to one instant.
- **Browser frozen to match.** `e2e/fixtures.ts` pins the browser `Date` to the same instant via a
  context-creation init script (a `Proxy` over `Date` — argless `new Date()` / `Date.now()` only,
  parsing and timers untouched), so client-side relative time agrees with the server and
  browser-stamped events (offline roll-call sync, signatures) are never "in the future" to the
  server's frozen clock. Registering it at context creation, not in a `beforeEach`, avoids a race
  that let the first test after a signed-in (storageState) context through on the real clock.
- **Full-page capture, nothing masked.** With the clock frozen, `e2e/visual.spec.ts` captures the
  full page with no masks, so a regression in a time or date is caught like any other.

## Alternatives considered

- **Keep masking** — cheap, but never stabilised layout shifts and hid real regressions in the
  masked text; this is what we are replacing.
- **Freeze only the server clock** — leaves client-rendered relative time and browser-stamped
  offline events on the live clock, so cross-boundary flows still drift and diff.
- **Playwright `page.clock` only** — freezes the browser but not the server-rendered SSR content
  or the seed, which is where most of the moving time lives; as the browser half it also proved
  racy from a `beforeEach` (a `Proxy`-over-`Date` init script at context creation is deterministic).

## Consequences

- One deterministic instant backs the whole e2e fleet; visual baselines are byte-stable run to run
  (verified: identical `DIVEDAY_CLOCK` → identical pixels; a shifted `DIVEDAY_CLOCK` moves only the
  time-derived content). The moment new nondeterminism enters a screenshotted surface it fails
  loudly under `retries: 0`, which is the point.
- New domain/data code must route time through `src/lib/clock.ts` (enforced). Server components
  should thread `nowDate()` too (a review expectation, not machine-checked); client components may
  read the browser clock, which the fixture freezes.
- The seeded demo shows a fixed calendar date under e2e; that is intended (stability). The
  production demo never sets `DIVEDAY_CLOCK`, so it stays live.
- Escape hatch: `E2E_FROZEN_CLOCK` is overridable via `DIVEDAY_CLOCK` for a one-off run at another
  instant. If Argos itself is ever dropped, the frozen clock and the seam remain useful on their
  own (deterministic e2e), so nothing here has to be unwound with it.
