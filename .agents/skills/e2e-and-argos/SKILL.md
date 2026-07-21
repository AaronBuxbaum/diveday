---
name: e2e-and-argos
description: Write and maintain end-to-end (Playwright) and visual-regression (Argos) tests that stay stable and complete. Use when adding or changing a user-facing flow or surface, when a visual baseline diffs on nothing but time, or when deciding what needs an e2e spec or an Argos snapshot.
---

# E2E flows and Argos snapshots

Two standing obligations, one stability model.

## Coverage — what must be tested

When you add or change a user-facing **flow**, it gets an e2e spec in `e2e/`. When you add or
change an important **surface**, it gets an Argos snapshot in `e2e/visual.spec.ts`. "Especially
for new features" is not a hedge — a feature without both is not done.

- **Important flow** = something a real user does that can break silently: booking, waiver
  issue/sign, cert or nitrox gating, roll call / manifest, refund/cancel, schedule a trip, sign
  in. New flow → happy path **and** the failure path that matters (full boat, uncertified diver,
  unsigned waiver, expired card). Bug fix → a failing regression spec first.
- **Important surface** = a page or state staff or divers actually look at, where a layout,
  contrast, or token regression would be felt. New surface → add a `capture(page, "<name>",
  scheme)` call in `e2e/visual.spec.ts` (it runs light + dark × phone + desktop automatically).
  Reuse the seeded Blue Mantis data; navigate to the surface the way a user reaches it.

If you're unsure whether something qualifies, it does. Under-covering safety-critical surfaces
(manifests, roll call, cert/medical gating) is never acceptable — those also get a
`dive-domain-expert` review.

## Stability — why the baselines don't drift

The demo seed is clock-anchored (one trip always sails *today*, cert expiries are relative) and
many surfaces render relative time. Against a live clock every Argos baseline diffs on nothing
but time. The fix is a **frozen clock**, not masking:

- The **server** clock is pinned by `DIVEDAY_CLOCK` (`playwright.config.ts`), read through
  `src/lib/clock.ts` — so the seed and every server render resolve to one fixed instant.
- The **browser** clock is pinned to the same instant by a context-creation init script in
  `e2e/fixtures.ts` (a `Proxy` over `Date`) — so client-side relative time agrees with the server,
  and browser-stamped events (offline roll-call sync, signatures) aren't "in the future" to the
  server's frozen clock, which would reject them as stale.
- `E2E_FROZEN_CLOCK` in `e2e/servers.ts` is the single source of that instant.

Because both clocks are frozen, screenshots are **captured full-page with nothing masked** — a
regression in a time or date is a regression Argos should catch. Do not reintroduce masks; masking
hides the pixels a real regression moves and never stabilised the layout shifts (a reordered queue,
a trip crossing from upcoming to sailed) a moving clock actually causes.

### Rules that keep it stable

1. **Never read the wall clock in `src/lib` or `src/db`.** Use `nowDate()` / `nowMs()` from
   `src/lib/clock.ts`. `pnpm check:clock` enforces this; it runs inside `pnpm check`. Keep the
   `now` parameter on domain functions for unit-test injection — just default it to `nowDate()`.
2. **Server components render relative time from the clock too.** A `new Date()` in a `src/app`
   server component isn't machine-checked but has the same failure mode — thread `nowDate()`.
   Client components legitimately read the browser clock; the fixture freezes it for them.
3. **Test-side dates come from the frozen instant.** In `e2e/`, use `daysFromNow()` / `e2eNow()`
   from `e2e/helpers.ts` (anchored to `E2E_FROZEN_CLOCK`), never `new Date()` / real
   `Date.now()`, when a value is compared against server state or a rendered date/year.
   (`Date.now()` purely for a unique email/title suffix is fine — it's never screenshotted.)
4. **No other nondeterminism in screenshotted data.** Deterministic ordering, stable seed, no
   `Math.random()` in rendered content. If a baseline flickers, find the source and remove it —
   the suite runs with `retries: 0` on purpose.

### Verifying a surface is actually stable

Frozen clock means the render is a pure function of that instant, so two runs are pixel-identical.
To prove it for a surface you added, capture it under two different `DIVEDAY_CLOCK` values:

```bash
DIVEDAY_CLOCK=2026-07-21T13:30:00.000Z pnpm e2e -- visual.spec.ts   # baseline instant
DIVEDAY_CLOCK=2026-07-21T22:00:00.000Z pnpm e2e -- visual.spec.ts   # 8h later
```

Same instant twice → identical pixels. Different instant → only genuinely time-derived content
moves. If something else moves, that's the nondeterminism to fix.

## When you're done

- New/changed flow has an e2e spec (happy + failure path); new/changed surface has an Argos
  snapshot in `visual.spec.ts`.
- `pnpm check` green (includes `check:clock`); `pnpm e2e` green.
- Intentional visual changes are called out in the PR so the reviewer approves the Argos diff.
