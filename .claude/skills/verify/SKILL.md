---
name: verify
description: Verify a change works before committing — checks, the running app, screenshots of changed UI. Use before every commit and whenever asked to confirm something works.
---

# Verify a change

This is the one pre-commit and pre-push checklist; AGENTS.md, `.claude/rules/` and `docs/agents/`
point here rather than repeat it, and [docs/agents/verifying.md](../../../docs/agents/verifying.md)
holds the why. A change is verified when you have **observed** it working, not when checks pass.

## The checklist

Before every commit:

1. **The guard you touched**: `node scripts/check-<name>.mjs`, or `pnpm check:repo` (every static
   guard, concurrently, every failure in one run) when you changed something a guard reads.
2. **`pnpm lint`** and **`pnpm typecheck`**.
3. **`pnpm test <file> --reporter=dot`** for each test file you touched or whose module you touched.
   After any edit under `src/db/schema/`, also the four schema guards, which nothing you edit
   selects:
   `pnpm test src/db/export.test.ts src/db/diver-merge.test.ts src/db/delete-path-coverage.test.ts src/db/retention.test.ts --reporter=dot`
4. **A flow changed**: one `pnpm e2e <spec> --reporter=line` (section 2).
5. **UI changed**: look at it (section 3).

Before every push:

6. **`pnpm test:changed`**: the tests your diff reaches through the import graph, which is the only
   local run that reaches a coverage guard in a file you never touched. After a schema edit it
   selects the whole suite; step 3's four guards stand in for it then.
7. **One validated push per round.** Commit as often as you like; push once, when the checklist
   is green for the round's work, because each push cancels the CI run of the one before it
   (the measurement is in [verifying.md](../../../docs/agents/verifying.md#one-validated-push-per-round)).
   A second push is right only when the `unpushed-work` hook is saving work before a turn ends,
   or when you push to learn what only CI can answer and say so in the PR.

CI runs anything whole: `pnpm check`, the whole unit suite, `next build`, the whole e2e suite and
the visual run. The shell guard refuses the bare local forms. When you do read a `pnpm check` log,
read the whole tail before fixing anything; the list at the bottom is complete.

## 2. Flows changed: e2e

```bash
pnpm e2e e2e/<flow>.spec.ts --reporter=line   # one spec; the whole suite runs on CI
```

If new user-facing flows were added, extend `e2e/` with a smoke spec for them first, and add a
visual snapshot in `e2e/visual.spec.ts` for any new surface (see the `e2e-and-visual` skill). `pnpm
lint` includes the `clock` rule, which fails if domain/data code reads the wall clock directly.

## 3. UI changed: look at it

Never ship UI you haven't seen. The visual spec asserts nothing — it writes PNGs at both the
phone and desktop widths — so a filtered run of it is the capture step. Look in light only; dark
joins it only when the change is colour work (a token, a tint, a hue — the owner's rule,
[H-90](../../../docs/product/human-decisions/README.md#decision-register)), and the `light mode.*` prefix
is what keeps the run to one scheme:

```bash
pnpm e2e:build
pnpm e2e:run e2e/visual.spec.ts -g 'light mode.*<name of the capture group>' --reporter=line
```

Read the PNGs in `e2e/screenshots/` (gitignored) and check them against the checklist at the bottom of
`docs/design/principles.md`. Then probe them: the same run with `PIXEL_PROBE=1` in front, then
`node scripts/pixel-probe-report.mjs`, and give every flag in `e2e/pixel-probe/REPORT.md` a verdict
— the `design-review` skill's pixel pass has the rest, and
[pixel-craft.md](../../../docs/design/pixel-craft.md) the rubric. For significant UI work, also run
the `design-review` skill. Send the screenshots to the user when reporting completion.

Prefer this Playwright-driven capture over backgrounding `pnpm dev` and browsing it manually: the
Playwright commands build, run, and exit on their own, while a backgrounded dev server doesn't —
see the `debug` skill's **Long-running background processes** section for why a leaked one causes
real problems (stale-server corruption, and sessions getting stuck waiting on a readiness signal
that a leftover process will never emit).

For a surface with no visual-spec capture group yet, or a quick mid-iteration look while a dev
server is already running, use `node scripts/screenshot.mjs <path> [--as owner]` — it captures
the light phone/desktop pair into `screenshots/` (gitignored), `--both` adds dark for colour work,
`--probe` runs the pixel probe on it, and it signs in through the seeded dev credentials for
`/shop/**` paths. Never hand-write a throwaway driver for this; the script exists so scratch
`.shots*.mjs` files stop reaching the index.

**A long capture run kills the dev server, and the corpse takes the next one with it.** Two facts
worth knowing before you point that script at thirty paths:

- A Turbopack `next-server` never unloads a route it has served. On a memory-capped container it is
  OOM-killed
  outright at roughly **thirty page renders** in 16 GB — well inside one capture matrix over a
  handful of staff pages. `scripts/dev-server.mjs` restarts it before the kernel does where it can,
  and `screenshot.mjs` shoots that path again by itself; a kill it cannot come back from is now
  reported as one, naming how many captures landed, rather than as
  "Nothing answering — start `pnpm dev` first" (issue #1321). Capture in smaller batches.
- **Restart with `pnpm dev`, never a bare `next dev`.** A server started over the build state a
  killed one left serves 404 for the routes that one was compiling, in ~50ms of application code
  and before any page code runs, until a file change forces Turbopack to recompile. That reads
  exactly like the change you just made breaking those routes — one session spent most of an hour
  on it, and a `git checkout` that "fixed" it made a correct change look like the cause. The
  supervisor now throws that state away before it starts and prints a `dev:` line saying so (issue
  #1882); a server started any other way needs `rm -rf .next/dev` first.

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
