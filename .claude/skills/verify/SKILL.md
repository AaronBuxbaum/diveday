---
name: verify
description: Verify a change actually works before committing — run checks, exercise the app, look at UI changes. Use before every commit and whenever asked to confirm something works.
---

# Verify a change

Run the layers that your change touches. A change is verified when you've **observed** it
working, not when checks pass.

## 1. Always: static + unit

```bash
pnpm check        # repo guards + biome lint + tsc + vitest
```

The four phases run concurrently and **fail slow**: one run reports every failure, not the
first. So read the whole tail before fixing anything — the list at the bottom is complete, and
fixing all of it in one pass is the point. A phase that passed prints one line; the failures
print in full, last.

## 2. Flows changed: e2e

```bash
pnpm e2e          # config auto-detects the sandbox Chromium; no install needed
```

If new user-facing flows were added, extend `e2e/` with a smoke spec for them first, and add a
visual snapshot in `e2e/visual.spec.ts` for any new surface (see the `e2e-and-visual` skill). `pnpm
check` includes `check:clock`, which fails if domain/data code reads the wall clock directly.

## 3. UI changed: look at it

Never ship UI you haven't seen. The visual spec asserts nothing — it writes PNGs at both the
phone and desktop widths, in light and dark — so a filtered run of it is the capture step:

```bash
pnpm e2e:build
npx playwright test e2e/visual.spec.ts -g '<name of the capture group>' --reporter=line
```

Read the PNGs in `e2e/screenshots/` (gitignored) and check them against the checklist at the bottom of
`docs/design/principles.md`. For significant UI work, also run the `design-review` skill.
Send the screenshots to the user when reporting completion.

Prefer this Playwright-driven capture over backgrounding `pnpm dev` and browsing it manually: the
Playwright commands build, run, and exit on their own, while a backgrounded dev server doesn't —
see the `debug` skill's **Long-running background processes** section for why a leaked one causes
real problems (stale-server corruption, and sessions getting stuck waiting on a readiness signal
that a leftover process will never emit).

For a surface with no visual-spec capture group yet, or a quick mid-iteration look while a dev
server is already running, use `node scripts/screenshot.mjs <path> [--dark] [--as owner]` — it
captures the light/dark × phone/desktop matrix into `screenshots/` (gitignored) and signs in
through the seeded dev credentials for `/shop/**` paths. Never hand-write a throwaway driver for
this; the script exists so scratch `.shots*.mjs` files stop reaching the index.

**A long capture run kills the dev server, and the corpse takes the next one with it.** Two facts
worth knowing before you point that script at thirty paths:

- A Turbopack `next-server` never unloads a route it has served. On a memory-capped container it is
  OOM-killed
  outright at roughly **thirty page renders** in 16 GB — well inside one capture matrix over a
  handful of staff pages. `scripts/dev-server.mjs` restarts it before the kernel does where it can,
  and `screenshot.mjs` shoots that path again by itself; a kill it cannot come back from is now
  reported as one, naming how many captures landed, rather than as
  "Nothing answering — start `pnpm dev` first" (issue #1321). Capture in smaller batches.
- **`rm -rf .next` before restarting.** A server started over the directory a killed process left
  behind serves the not-found page for **every `/shop/**` route**, in ~50ms of application code,
  until a file change forces Turbopack to recompile. That reads exactly like the change you just
  made breaking every staff route — one session spent most of an hour on it, and a `git checkout`
  that "fixed" it made a correct change look like the cause.

## 4. Behavior changed: exercise it

For domain logic with no UI yet, drive it directly (a scratch script or `vitest run` on the new
tests) and confirm outputs on realistic inputs — including the failure paths (full boat,
uncertified diver, a nitrox request with no verified card).

## 5. File what you're leaving behind

Before you report done, empty your head into GitHub issues — one issue per item, labelled
`needs-triage` (see [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)'s "Filing
a follow-up" section):

- the improvement you can see but were not asked for
- the question whose answer would have changed what you built
- the risk or latent bug you noticed in nearby code
- the assumption you made where the other branch deserves a human's look
- work you started and deliberately stopped (say what is half-done, and where)

Then say in your closing message that you filed them, by issue number. A thought that exists only
in your final message is gone the moment the session ends — that is the whole reason the tracker
exists. `pnpm check:follow-ups` will refuse an issue whose prompt is too thin to run cold. Filing is
never a substitute for the work you were asked to do, and never the answer to a failing test.

## Report honestly

State what you ran and what you observed. If anything is red or unverified, say so plainly —
never mark work done with failing or skipped verification. A red or flaky test doesn't get
skipped just because it's unrelated to your change — see the `debug` skill's Ownership section
before fixing it, so you don't duplicate a fix already in flight on another PR.
