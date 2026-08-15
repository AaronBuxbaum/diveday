# FU-20260815-something-leaks-next-server-processes — Find what leaves `next-server` running after its owner exits

- **Status:** Open
- **Raised:** 2026-08-15 — cleaning up after a nine-hour wait-loop. The loop was mine and is fixed;
  these are a *different* leak that the cleanup happened to expose, and nothing yet explains them.
- **Kind:** risk
- **Effort:** M
- **Touches:** `e2e/servers.ts`, `e2e/global-setup.ts`, `playwright.config.ts`, `package.json`,
  `scripts/stray-processes.mjs`

## What I noticed

Two `next-server` processes had been running for **sixteen days** — started 2026-07-29 22:33,
reparented to init (`ppid 1`), listening on **no TCP port at all**, holding **3.6 GB** of resident
memory between them, with a working directory of the main checkout rather than any worktree.

They were not from the session that found them, and no session's task list has ever known about
them: their owner exited without reaping them, on a day nobody remembers.

`scripts/stray-processes.mjs` now *reports* this class on every `Stop`, and `SessionEnd` reaps it.
That is the symptom handled. What is not known is **what created them**, and a reporter that fires
every fortnight because something keeps leaking is a reporter people learn to skim.

The suspects, none confirmed:

- **The e2e fleet.** `e2e/servers.ts` starts a `next start` per Playwright worker. A run killed
  between `globalSetup` and teardown — Ctrl+C, a crashed shard, a harness timeout — plausibly leaves
  them. `reuseExistingServer` being on locally means a leftover fleet is silently *reused* rather
  than noticed, which is exactly how one survives long enough to be forgotten (this bit a session on
  2026-08-15: a stale fleet served a stale build for ninety tests).
- **`pnpm dev`** in a terminal that was closed rather than interrupted.
- **A `next build`/`next start` from a script that was killed mid-run.**

The listening-on-nothing detail is the strongest clue and points away from a plain `pnpm dev`: these
had *released* their ports but never exited, which is closer to a worker whose supervisor died than
to a server someone forgot about.

## Why it isn't already done

The evidence is gone. The processes were killed to free the memory before anyone thought to inspect
their open file descriptors, environment, or start command — `ps` only ever showed
`next-server (v16.3.0-preview.9)`, which names neither the port nor the invocation. Guessing at a
teardown fix for a mechanism nobody has established is how a real leak gets papered over with a
`pkill` in a script.

It also matters more now than it did: the same hook ships to Claude Cloud's Linux runners, where a
3.6 GB leak is a runner that stops working rather than a laptop that gets warm.

## Proposed change

1. **Catch the next one before killing it.** `scripts/stray-processes.mjs --list` reports them; when
   one appears, capture `lsof -p <pid>`, `ps -o lstart,command -p <pid>`, and the environment
   (`ps eww -p <pid>`) *first*. The `PORT`/`__NEXT_PRIVATE_*` variables in that environment should
   name the fleet member and therefore the harness that started it.
2. **Then fix the teardown that let it happen**, in whichever of the three suspects it turns out to
   be. If it is the e2e fleet, `e2e/servers.ts` wants a `process.on("exit")`/signal handler that
   kills the whole process group, not just the child it spawned.
3. Consider whether `reuseExistingServer` should stay on locally. It converts a leaked fleet from a
   loud failure into a silent stale-build failure, which is the more expensive kind.

**Not proposed:** adding a blanket `pkill next-server` to a `pretest`/`predev` script. That hides the
leak, and it would kill a *sibling session's* live dev server on a shared machine — the same mistake
`--kill`'s session scoping exists to avoid.

## Prompt

```text
Something in DiveDay leaves `next-server` processes running after their owner exits. Two were found
on 2026-08-15 that had been up for sixteen days, reparented to init, listening on nothing, holding
3.6 GB between them.

Read docs/product/follow-ups/FU-20260815-something-leaks-next-server-processes.md first. Note that
`scripts/stray-processes.mjs` already REPORTS this class on every Stop and reaps it on SessionEnd,
so the symptom is handled -- this entry is about the cause, and a reporter that keeps firing is one
people learn to skim.

The evidence from the original pair is gone: they were killed to free the memory before anyone
captured their environment. So step one is to catch the next one alive. Run
`node scripts/stray-processes.mjs --list`, and when it reports a next-server orphan, capture
`lsof -p <pid>`, `ps -o lstart,command -p <pid>` and `ps eww -p <pid>` BEFORE killing it. The
PORT / __NEXT_PRIVATE_* variables in that environment should identify which harness started it.

Prime suspect is the e2e fleet: e2e/servers.ts starts a `next start` per Playwright worker, and a
run killed between globalSetup and teardown plausibly strands them. If that is it, the fix is a
signal/exit handler that kills the process GROUP rather than the one child it spawned. Also weigh
whether `reuseExistingServer` should stay on locally -- it turns a leaked fleet from a loud failure
into a silent stale-build one, which already cost a session ninety tests on 2026-08-15.

Do NOT add a blanket `pkill next-server` to a pretest/predev script. That hides the leak, and on a
shared machine it kills a sibling session's live dev server -- the exact mistake the --kill session
scoping in stray-processes.mjs exists to avoid.

Done when: the mechanism is named with evidence, the teardown that allowed it is fixed, and
`pnpm check` is green. Delete
docs/product/follow-ups/FU-20260815-something-leaks-next-server-processes.md as part of the change.
```
