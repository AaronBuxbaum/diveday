# FU-20260820-vitest-shard-sigill-on-pglite-teardown — Stop a V8 WASM crash killing a random unit shard in CI

- **Status:** Open
- **Raised:** 2026-08-20 — seen on PR #573's shard 2/4, then found already failing on `main` at
  c72ef6d (the merge of #572) in shard 3/4
- **Kind:** risk
- **Effort:** M
- **Touches:** `.github/workflows/ci.yml`, `src/test/db.ts`, `vitest.config.ts`, `package.json`

## What I noticed

A random one of the four `Unit tests shard N/4` CI jobs dies mid-run with a V8 fatal, not a test
failure:

```
# Fatal error in , line 0
# Check failed: jit_page_->allocations_.erase(addr) == 1.
...
v8::internal::ThreadIsolation::UnregisterWasmAllocation(unsigned long, unsigned long)
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command was killed with SIGILL (Invalid machine instruction)
```

No test failed and no assertion was reported — the worker process is killed outright, so the shard
exits non-zero with a green-looking dot line. It is **not branch-specific**: the same crash, with
the same `Check failed` line, killed shard 3/4 on `main` at c72ef6d
(`actions/runs/32271938173/job/96130227897`) and shard 2/4 on PR #573 at cf14914
(`actions/runs/32323811361/job/96290945951`). The shard that dies moves between runs, which is what
makes it read as a flake rather than a standing failure.

The crash is in V8's thread-isolation bookkeeping for **WASM** code pages, freed as a WASM instance
is torn down. The only WASM in this suite is PGlite: every db-backed test opens its own embedded
Postgres and `closeWhenTestFinishes` closes it (`src/test/db.ts`), so the suite performs ~900
open/close cycles per full run, hundreds per shard.

## Why it isn't already done

Out of the scope of the change that surfaced it, and it is a toolchain problem rather than an
application one — the fix is a Node/V8 flag, a Node version, or a change to how many PGlite
instances a worker tears down, none of which belongs inside a UI PR. It also needs somebody to
decide how much CI time a mitigation may cost, which is a judgment call rather than a code one.

What makes it worth raising rather than waiting out: a SIGILL looks exactly like a flake, and the
house rule is that a flaky test is part of the work. Every PR now has a roughly one-in-N chance of
a red shard that nobody can reproduce locally, and the standing advice ("re-run once") quietly
becomes "re-run until green", which is the habit this repo has deliberately refused elsewhere.

## Proposed change

In rough order of preference:

1. **Pin the Node minor in CI and try the next one.** `.github/actions/setup` resolves whatever
   `setup-node` gives it; this class of `ThreadIsolation` check failure has been fixed and
   reintroduced across V8 versions, so the cheapest experiment is moving the runner's Node and
   watching a dozen runs.
2. **Run the WASM-heavy suite with `--no-experimental-wasm-...`/`--single-threaded-gc`-style flags**
   via `NODE_OPTIONS` on the unit-test job only, so the mitigation does not slow local runs.
3. **Cut the number of teardowns.** A worker-scoped PGlite reused across tests in one file, with
   per-test truncation instead of per-test hydration, would take the cycle count down by an order
   of magnitude. Much larger, and it trades the isolation `seededTestDb`'s doc comment defends —
   only worth it if 1 and 2 fail.

Do **not** paper over it by retrying the shard: a retry that turns a process crash green is the
exact shape `pnpm check:e2e-hygiene` refuses in `e2e/`, and the same reasoning applies here.

## Prompt

```text
DiveDay's CI kills a random one of its four `Unit tests shard N/4` jobs with a V8 fatal rather than
a test failure: "Check failed: jit_page_->allocations_.erase(addr) == 1" inside
v8::internal::ThreadIsolation::UnregisterWasmAllocation, ending in SIGILL. It is not
branch-specific — main at c72ef6d lost shard 3/4 the same way
(actions/runs/32271938173/job/96130227897) and PR #573 at cf14914 lost shard 2/4
(actions/runs/32323811361/job/96290945951). No test fails; the worker dies.

Read first: .github/workflows/ci.yml and .github/actions/setup (how the unit shards run and which
Node they get), src/test/db.ts (seededTestDb / closeWhenTestFinishes — every db-backed test opens
and closes its own PGlite, which is the only WASM in the suite), and vitest.config.ts.

The constraint that makes this non-obvious: it reproduces only under CI's Node and only sometimes,
so you cannot iterate against a local failure. Judge a candidate fix by watching runs, not by one
green run.

Try, in order: pinning/raising the Node minor the runner uses; a NODE_OPTIONS mitigation scoped to
the unit-test job; and only if those fail, reducing PGlite teardowns by reusing one instance per
test file. Do NOT add a retry to the shard — a retry that turns a process crash green is the shape
this repo refuses in e2e/ for the same reason.

Done means: the crash has not recurred across at least ten CI runs, and whatever was changed
carries a comment saying what it is working around and how to tell when it can be removed. Run
pnpm check locally before pushing. Delete
docs/product/follow-ups/FU-20260820-vitest-shard-sigill-on-pglite-teardown.md as part of the change.
```
