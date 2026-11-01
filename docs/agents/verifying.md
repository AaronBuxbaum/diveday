# Where a check runs: your container, or CI

The short rule is in [AGENTS.md](../../AGENTS.md)'s hard rules. This is the reasoning, and the
line between the two.

## Run locally: anything you can scope to the change

The list is the **verify** skill's checklist ([SKILL.md](../../.claude/skills/verify/SKILL.md)),
and only there. Everything on it is scoped to your diff, which is the whole test for "local"; the
sections below are why each line is on it, and why the rest is not.

## The unit suite's projects

`vitest.config.ts` splits the suite into Vitest projects by what each file needs, read from its
source by `src/test/projects.ts`. `pnpm test <file>` and `vitest related` are unchanged: they
see one run across every project. CI's four unit shards run every project but `guards`
(`--project '!guards'`), dealt together by the shard sequencer; `guards` runs once, in the
`Repository safeguards` job, because it is bounded by reading the repository rather than by test
count.

| Project | Holds | Runs as | Shortcut |
| --- | --- | --- | --- |
| `db` | every file importing `@/test/db`, `@/test/postgres` or `@/test/query-count`, or building a database itself | forks, isolated; the only project that runs the PGlite global setup | `pnpm test:db` |
| `ui` | every file with a `// @vitest-environment jsdom` docblock | jsdom, forks, isolated | `pnpm test:ui` |
| `lib` | pure `src/lib` files that mock no module | one shared worker (`isolate: false`) | `pnpm test:lib` |
| `guards` | source-text guards: files that read the repository and import nothing from the app | one shared worker (`isolate: false`) | `pnpm test:guards` |
| `scripts` | `scripts/**` | forks, isolated | `vitest run --project scripts` |
| `node` | everything else | forks, isolated | `vitest run --project node` |

A project shortcut is for a sweep after a change to a shared helper (`src/test/db.ts` →
`pnpm test:db`), not a substitute for `pnpm verify:push`; `test:db` is the expensive one, minutes
on a quiet box. A `src/lib` file that starts calling `vi.mock`, `vi.stubEnv` or `vi.resetModules` moves
itself to `node` on the next run; a `lib` file that leaks state another way shows up as an
order-dependent failure, which `pnpm test:lib --sequence.shuffle` reproduces.

## The guards that live in files you will never edit

A focused `pnpm test <file>` runs the tests you can name. The **coverage guards** are the ones you
cannot: `src/db/export.test.ts`, `src/db/diver-merge.test.ts`, `src/db/delete-path-coverage.test.ts`
and `src/db/retention.test.ts` assert over the schema (`src/db/schema/`) from files whose whole job is to
notice something you added
*elsewhere*. Nothing you touch selects them, so they go red on CI instead — four times in one
afternoon on 2026-09-05: slice 16g's four columns, 16i's `recap_pulses` table and its
`addressed_by_person_id`, and 16j-B's two `person_id` columns. Every one of those agents had run
the documented local gate correctly.

An import-graph run (`vitest related`) catches all four, and the pre-push gate's full unit run (step 3)
does too, which is why the full run is a pre-push step rather than a mid-iteration convenience. Know an
import-graph run's cost before you start one mid-iteration: the schema sits
in nearly every import chain (every module under `src/db/schema/` is reached through its `index.ts`), so a diff touching it selects the **whole** suite — 9,391 of 9,391
entries, measured 2026-09-06 — and on a stack the diff against `origin/main` is every layer
beneath you, so that is a floor rather than a ceiling. That run belongs to the pre-push gate. When you touched
a file under `src/db/schema/`, name the four by path instead:

The command is step 3 of the verify skill's checklist: 40 tests, about a minute, and it catches
every failure listed above. The trigger is touching
any schema module at all — 16j-B added only columns and tripped two guards.

## The pre-push gate

**Removed 2026-10-25** (Aaron: "remove the push guard and the verify:push requirement"). Nothing
refuses a `git push` now; CI is the gate and a red run is fixed forward. `pnpm verify:push` stays as
an optional local run. What follows is why it was built and what it measured.

Measured on the open stack between 2026-10-09 and 2026-10-12: 169 CI runs, 18 failed and 128
cancelled, and 90 failed jobs inside them. Classified from their annotations and logs:

| Failed jobs | What broke | Would a local run have caught it? |
| --- | --- | --- |
| 47 Playwright | a spec the change broke: a deleted sentence a spec still quoted (`sightings`), a moved seeded shift (`staffing`), a second "Crew schedule" destination (`search`), a recounted reviews line, a folded editor with two "Location" fields | yes, by running that spec; the checklist said "one spec", and nothing told the author which |
| 23 unit | tests that read source from disk (`form.test.tsx`, `button.test.ts`, `EntryShell.test.tsx`, the erasure and rehearsal coverage scans), and the export snapshot after a seed change | yes, but `vitest --changed` cannot select a test that imports nothing it checks |
| 9 safeguards | the `guards` Vitest project (`eyebrow-way-up`, `focus-ring`), and four pull request bodies | yes; no local step ran either |
| 2 typecheck | fixtures a merge from the layer below broke | yes; the layer's checks had run before the merge |
| 5 visual, 2 reg-suit | one capture that timed out on a moved heading | yes: the gate runs the captures a diff names, in light mode (`selectCaptures`, `scripts/e2e-affected.mjs`) |
| 2 build | Google Fonts unreachable at build time | no: infrastructure |

So the problem was never flakiness. A stacked change that breaks a spec breaks it on every layer
above it, which is how one deleted sentence became twelve red Playwright shards.

`pnpm verify:push` (`scripts/verify-push.mjs`) runs the local half of every row above against
the layer below (`resolveVerificationBase` in `scripts/verification-base.mjs`: the open PR's base;
else `--base <ref>` or `git config branch.<branch>.divedayBase origin/<parent>`; else the nearest
remote layer HEAD contains; else `origin/main`), stops at
the first red step, and writes a stamp naming HEAD into the git directory (keyed by sha in the
common git dir too, so a push from any worktree finds it):

1. `pnpm regen` (with the export snapshot when seed, schema or export changed), then a clean
   tree: a generated file the diff left stale is committed, not discovered by CI.
2. `pnpm lint`, `pnpm typecheck`, `check:repo`, and the `guards` project (seconds).
3. The whole unit suite, as CI's four shards (`--project '!guards' --shard=n/4`), one step each.
   Until 2026-10-15 this was every `src/` test that reads files from disk plus `vitest related`
   over the changed code, and every other unit test was CI's first run; Aaron chose "run
   everything" over that saving. CI runs the four shards in about six minutes each.
4. The Playwright specs `pnpm e2e:affected` selects, after an `e2e:build` it reuses while
   nothing the build reads has changed (`.next/diveday-build-evidence.json`, a content
   fingerprint without tests, written by `scripts/e2e-build-evidence.mjs`, so a commit that only
   fixes a spec reuses it). *Strong*: specs the diff edits or whose helper it edits, specs
   quoting text the diff removed (a locale value, JSX text, a seed literal), and specs visiting a
   route whose own directory the diff edits. *Smoke*: five tests (`SMOKE`: booking, a waiver,
   check-in, roll call offline, sign-in), run as `file:line` whenever the app changed. *Reach*:
   specs visiting a route the diff's changed names reach (`scripts/symbol-reach.mjs`, name by
   name rather than file by file), or a hub route (one more than ten specs visit), ranked by how
   much of the diff's vocabulary a spec names, then narrowest first. Every selected spec runs, in
   steps of 25: until 2026-10-15 a time budget left the rest to CI, and on #2619 that was 30 of
   129, one of which went red there. The run uses as many Playwright workers as the box has free
   compute for, and no more (Aaron, 2026-10-15): `max(1, min(floor((cores - one-minute load) /
   3), cores/2))`, read before each step and printed with it; an `E2E_WORKERS` you set wins. Three
   cores per worker because each brings its own Next server and Chromium: on an idle four-core
   cloud container two workers timed out on specs CI passes (`readiness.spec.ts:131`,
   `diver-merge.spec.ts:42`), and one passed them, so CI's 15-second test ceiling stays the bar
   ([why](#why-a-spec-times-out-here-and-not-on-ci): the per-test reset, measured). The
   container's older fallback Chromium, which the run names once, is not the cause: a Playwright
   pinned to that same browser failed identically. A diff of only unit tests runs no spec and builds nothing.
   `--commit <sha>` replays one commit; over 104 commits the median reach fell from 65 specs to
   19 with the name walk.

A green run ends with **"Not run here"**, also recorded as `notRunHere` in the stamp: the
Playwright specs the diff neither names nor reaches, and the visual captures it does not name (the ones it names run, in light mode, after the specs; dark mode and the reg-suit comparison stay CI's). CI runs those first, so a report says "verify:push green",
never "all tests pass locally".

Replayed against the commits that broke specs on 2026-10-11 and 2026-10-12, the selection ran
the broken spec in five of six: the sightings disclaimer, the reviews count, the dive-site editor
fold, the shop name in the phone bar, and the second "Crew schedule". The miss was a seed change,
which reaches every route and so ranks staffing behind thirty other specs. A local run takes
about 1.4 times the recorded CI time (four specs: 291 s against 204 s recorded), plus three
minutes for a cold build.

Until 2026-10-25 a `git push` of a commit with no stamp was refused by a hook; that hook is gone.

### The quick run, and fixing forward

On 2026-10-16 Aaron called time on the full run as the default: "stop the pattern of waiting for
the full validations on these, just batch up work into single large PRs and stack them, adapting
when CI fails". On a four-core cloud container the full run took most of an hour for a change
that reached many routes, and every thread behind it in the stack queue waited too.

So `pnpm verify:push --quick` is the run a push expects. It keeps steps 1 and 2 above (regen and
check the tree is clean, lint, typecheck, `check:repo`, the whole `guards` project). Unit selection
uses native `vitest related` for production imports and aliases, augmented conservatively with
source-reading tests and their filesystem-reading helpers. This includes mixed behavior/source
contracts and documentation inputs. Database snapshot loaders are operational fixture I/O;
schema, migrations and test infrastructure changes instead run all unit tests. Source/test deletions,
global configuration and unknown inputs also fall back to the whole unit suite. A test-only diff runs
edited tests directly when they neither export fixtures nor appear in other tests; otherwise it
keeps native dependency selection. This branch's own last red run's failures are included in
either mode ([below](#a-red-run-on-this-branch)); the base's are replayed by the full run only
([below](#a-red-base)).

**A merge-only push** (Aaron, 2026-10-22): when every commit since the branch's last push is a
merge of another branch (the layer below, or main) and nothing of its own, those commits already
had their own CI. The quick run then checks the merge result statically and runs units only for
this branch's own red CI. Without this, any merged schema or migration file pulled in the whole
unit suite, and the cascade after #2932 merged main waited 20 to 30 minutes on it.

`pnpm test:affected --plan` shows this local selection against the nearest contained remote
branch below HEAD; `--base <ref>` selects an explicit base. Without `--plan`, it runs the whole
guards project and selected units. This developer command includes working changes and untracked
files; the push gate measures committed HEAD. Quick mode discovers only the diff, without
building browser dependency graphs. It builds and runs browser specs only when this branch's
own last CI run names failed specs. Those targeted replays run after selected
units, using the same build reuse, bounded chunks and worker policy as the full gate. A missing
named unit test or browser spec stops verification instead of silently dropping that failure.
Its stamp names what it left to CI; CI continues to run the whole unit and browser suites.
Conservative reader selection
is deliberately broader than exact runtime impact.

The trade is explicit: CI is now the first to run the browser for most pushes, and a red job is
the next commit on the same layer, worked as soon as it comes back. The base-CI read below runs
in both modes, but only the full run replays the base's failures and refuses on them. A quick run
names them in a warning and stamps (Aaron, 2026-10-22: a fix-forward on a red main waited an hour
for main's own failure to pass here). The stamp records replayed specs and excludes them from the
browser tests left to CI. The full
run is still there for a change where the browser's answer is worth the hour before CI's.

### Why a spec times out here and not on CI

Measured 2026-10-17 on a four-core cloud container (Intel Xeon at 2.8 GHz) on a built server,
for #2624 and #2568. **The per-test `/api/test/reset` is the cost, not cold routes.** It restores
the demo schedule with about 830 statements (303 selects, 258 inserts, 158 updates, 110 deletes,
the deletes 1.8 s of it) and costs 3.9 to 5.3 s of single-core server CPU on every run, wall
time matching CPU time, so it is compute and not waiting. It is a test-scoped fixture, so it is
billed to the test's 15 s budget, and with the sign-in it leaves the body 6 to 8.5 s:

| Run (load average) | Fixture setup | of which reset | Body before the 15 s ceiling | Result |
| --- | --- | --- | --- | --- |
| `readiness.spec.ts:131` ×4, 1 worker (3 to 6) | 6.6 to 8.3 s | 4.5 to 4.9 s | 7.0 to 8.7 s | 4 of 4 timed out |
| `readiness.spec.ts:131` ×4, 2 workers (6 to 12) | 9.0 to 9.7 s | 5.1 to 5.6 s | 5.7 to 6.3 s | 4 of 4 timed out |
| `manifest.spec.ts` "plan changed", "transposed" ×6, 1 worker (5 to 16) | 6.3 to 8.9 s | 4.4 to 5.3 s | 6.6 to 9.0 s | 5 of 12 timed out |

A warmed route answers in 10 to 250 ms, so widening `e2e/global-setup.ts`'s warm-up list buys
nothing. CI records 45.4 s for all eight `readiness.spec.ts` tests, about 5.7 s a test with its
reset, so its runners do the same work several times faster; their per-request timings could not
be read from here (job logs and artifacts are refused). The `?checkpoint=after_dive_1` RSC request
#2568 saw abort does too in these runs, answered 200 in 35 ms, and the page reaches the
checkpoint: noise, as #2332 found for the Divers request. Neither manifest test has failed on CI
in the 300 failed CI runs from 2026-09-05 to 2026-10-16 (1,348 failure annotations read).

So a local timeout in a spec that pays a reset and a long walk, with no other error before
"Test timeout of 15000ms exceeded", is this container's CPU; CI's ceiling stays the bar and the
timeout is not raised. Check the trace's `Before Hooks` step before debugging the body: past
6 s, it is this. A cheaper reset is the fix that would move it.

Measured again on 2026-10-18 for #2624, at load averages of 10 to 14 from other sessions:

- **Server CPU per test, from `/proc` rather than wall time:** about 11 s for `readiness.spec.ts:131`
  (the reset 5.5 s, the body 5.5 s), over a first reset of about 30 s. Three repeats on one server ran
  16 to 38 s with the 15 s ceiling lifted for the measurement, so a warm server is not faster than a
  cold one and the warm-up list is not the lever.
- **The reset is WASM Postgres.** A CPU profile of one server puts 30 s of 72 in the Postgres
  WASM, 14 s in PGlite's JavaScript file system, 4.7 s in garbage collection. `--max-semi-space-size=64`,
  `--no-wasm-dynamic-tiering` and `--wasm-tiering-budget=1000000` left the reset at 5.1 to 6.0 s,
  inside the noise of the 5.4 to 6.6 s without a flag, so the server command carries none.
- **The first reset can outlast its old 30 s bound.** It failed the run at the global setup here,
  before any test started; the bound is now 120 s (untimed setup, not a test). The browser warm-up
  now runs after the servers instead of beside them: its first navigation read 22.3 and 27.2 s
  queued behind worker 0's seed, and reads 1.3 s after it.
- A cheaper reset stays the fix, and it is #2729's (`src/db/seed.ts`).

### A red run on this branch

Fixing forward had a hole of its own. A push meant to fix a red run went out behind
`verify:push --quick`, which runs no browser, so the next CI run, about 22 minutes later, was the
first to say whether the fix worked. In the week from 2026-10-16 to 10-22, 37 pushes followed a
red run on the same PR; 18 came back red again, and 14 of those were still red on a test the run
before had already named (the review is in the PR that added this section).

So `verify:push`, in both modes, also reads this branch's own latest finished CI run
(`scripts/own-ci.mjs`). When it is red, what it names runs here:

- **Unit shards**: the files `src/test/failed-files-reporter.ts` annotated.
- **Playwright shards**: each failed test's spec file, read from the "Playwright Run Summary"
  notice (a failure annotation can point at `e2e/fixtures.ts` rather than the spec).
- **Visual capture shards**: each failed capture by title, in light mode. A capture that fails is
  a functional failure, a heading it waits for gone or a timeout, not a pixel difference; reg-suit
  compares pixels, and its "Refuse a green check over nothing compared" step goes red whenever a
  capture shard does, so fix the capture and reg-suit follows.
- Lint, Typecheck and Repository safeguards run here anyway; a job naming nothing (Build, say)
  gets a line with its run's link: read its log before pushing.

It never refuses and fails open when GitHub cannot answer. The stamp records what it replayed
(`ownCi`). The cost is the e2e build plus the named files, a few minutes, against a 22-minute CI
round per miss.

### A red base

The gate as first built had one hole, and on 2026-10-14 it was the whole of what went red. Main
went red at d5014c5f1, a dependency bump pushed straight to `main` with no PR (lint, and PGlite
0.5.10 hanging in `close()` on two unit shards). Every layer that merged main inherited it, and
the override's commonest reason became "red on main, not mine": #2594 pushed that way, and #2608
pushed past a worktree stamp the guard could not yet see. A push on a red base is certain to be
red, on that layer and on every layer above it, and each of those layers then pushes again to
merge the fix. Since 19:49 that day, eight CI runs started across six open PRs, most of them
merges from below.

So `verify:push` reads the layer below's latest CI before anything else (`scripts/base-ci.mjs`):

- **Green**: one line, and on.
- **Still running**: a note. If it goes red, this layer is red with it; read it again before
  merging it a second time.
- **Red**: Lint, Typecheck and Repository safeguards are answered by the gate's own steps, so a
  green run here is the fix carried. A red unit or Playwright job adds the test files its
  annotations name to this run (the unit shards annotate each failed file through
  `src/test/failed-files-reporter.ts`; Playwright annotates each failed spec), and the stamp
  means they passed here. A red job that names no file is refused until the author reads its log
  and names the files: `pnpm verify:push --base-red <file…>`, which then run here too. Visual
  capture and reg-suit are left out: a push approves those (**visual-triage**). So is every run
  the base got from an event a PR never runs on (a schedule or the Run workflow button: CodeQL,
  Simulate a day, Follow-ups): its red is not something this layer inherits or can fix.
- **Unreadable** (no `gh`, no network): a line saying so, and on. The gate fails open; CI still
  answers.

That replay and refusal belong to the full run. A quick run prints the same verdict, names the
base's failures as "not replayed in a quick run, red on the base and its owner's to fix", and
stamps: the red stays the base owner's job and the banner below stays loud, but a fix-forward
push is not held behind a failure it did not cause.

The stamp records what it found (`baseCi`). The fix for a red base goes where the break is when
that layer is still open (its owner, through the coordinator), or rides in this layer when it
cannot wait; either way, nothing is pushed red on purpose.

**Loud, with the layer's name.** When the base is red on test files this branch does not edit,
`verify:push` prints a `THE LAYER BELOW IS RED` banner naming that layer's branch and pull request
before it runs them (`scripts/red-below.mjs`). Fix the bottom first, then
`pnpm stack:sync` merges it up one layer at a time (the **stacked-prs** skill).

The PR body rows are a separate gate: `scripts/guard-pr-body.mjs` runs `check-pr-body.mjs`
before the GitHub MCP creates or edits a pull request.

## Push and read CI: anything whole

`pnpm check`'s unit phase, the whole unit suite, `next build`, the whole `e2e/` suite, and the
visual run. The pre-push gate above runs the part of each a diff can reach; CI runs them whole.

**Why.** CI shards the unit suite four ways across dedicated runners and runs lint, typecheck,
build, the safeguards and the Playwright shards beside it, in parallel. One agent container runs
the same work serially on four cores. Measured on 2026-08-28: a full local unit run passed twenty
minutes without finishing, at a load average above eight, while CI answered the same question in
a few. Worse than the wait is what it does to everything else — a saturated box starves the dev
server, a focused spec, and any parallel session sharing the machine.

A change that touches only `docs/`, Markdown or `.claude/` skips the four unit shards along with
the build and the browser jobs; `Unit tests that read docs` runs the unit files that quote a
document path instead. Every sharded job is dealt by recorded CI durations, with a source estimate
for what is new since: the unit shards by file from `scripts/test-durations.json`
(`src/test/shard-sequencer.ts`), the Playwright shards by spec and the visual shards by test from
`scripts/e2e-durations.json` (`scripts/e2e-shard.mjs`, whose bin weights each shard prints in its
job summary). Both files refresh themselves: `.github/workflows/durations-refresh.yml` reads the
newest main run's `unit-durations-<n>`, `e2e-durations-<n>` and `visual-durations-<n>` artifacts
every Monday, and from its Run workflow button, and commits them straight to `main` when they
moved (a pull request on `automation/durations-refresh` only if that push is refused). To
refresh by hand from a container that cannot download artifacts, save each shard's job log (the
unit shards print a `diveday-test-durations:` line, the browser shards a `diveday-e2e-durations:`
one) and run `node scripts/merge-test-durations.mjs <logs…>` or
`node scripts/e2e-durations.mjs merge <logs…>`.

**So the PR is the instrument, not the trophy.** Open it before it is green when that is the
fastest way to learn what is broken; say so in the body, name what you have and have not run, and
work what comes back. This does not license pushing carelessly: a push that turns CI red costs a
cycle and reviewers' trust, so `pnpm verify:push` still runs first, and a push past it carries
its reason in front of the command and in the body.

**And a red PR is a PR you are still driving.** The licence to push before green is a licence to
find out, never to walk away. A pull request left red with nobody working it is the thing this
rule must not become — see AGENTS.md's rules on visual diffs and review threads, which apply from
the moment it is open.

### The fast lane: an early browser answer

On a pull request, CI's `Fast lane` job starts when the build's artifact exists and runs, on one
runner, what is most likely to be red: the spec files and capture titles the branch's latest
finished red CI run named (`scripts/own-ci.mjs`, the reading `verify:push` replays), then the
`strong` tier of `scripts/e2e-affected.mjs` against the pull request's base, capped at about four
recorded CI-minutes, and what those leave of the four minutes filled with the repository's
recent-failure specs (newest first, at most eight) and then the tests main's last run measured over
90% of their budget (`scripts/fast-lane.mjs`; its job summary names every list, what the cap left
out, and a reading skipped because GitHub could not be read). It reports under its own check in a few minutes rather than the ~22 a full run took
(2026-10-22). It decides nothing: `continue-on-error` keeps it from failing the run, and the
Playwright and visual capture shards run every one of its tests again and still decide green. A
red `Fast lane` is the same failure the shards will report; start on it without waiting for them.

### This layer plus main

A stacked layer's pull request targets the layer below, so GitHub's merge ref, which CI tests, is
that layer plus the one below, never main. `.github/workflows/main-tip.yml` closes the gap for every
pull request whose base is not main: its `This layer plus main` check merges main's current tip into
the head and runs `pnpm check:migration-graph`, `pnpm typecheck` and `pnpm check:repo`, stopping at
the first that fails. The job summary says "This layer plus main: OK" or names the conflict or the
first error. It is not part of `CI result`, so a red main does not hold every stack; a red check
here is a break the layer will meet on main, and the time to fix it is now. It was added after a
migration diamond and run 39823408515 (`Cannot find name 'diverTranslator'`) reddened main on
2026-10-23, each from two layers that were green alone.

### The weekly CI health check

`.github/workflows/ci-health.yml` runs `node scripts/ci-health.mjs` every Monday over the pull
requests merged or updated in the last seven days, and writes to its job summary: red CI runs per
pull request, the share green on their first run, the repeat-red rate (of the pushes that
followed a red run, how many were red again on a test that run had named), the median and p90 CI
run, and the failing jobs ranked. A week over 1.0 red runs per pull request or 25% repeat red
opens one `needs-triage` issue, or comments the week on the one already open. Run it by hand the
same way (`--days <n>`; add `--file-issue --dry-run` to see what it would file).

## Neither: the tracker scan

`pnpm check:follow-ups` reads the live issue tracker, not your branch, so no pull request runs it:
`.github/workflows/follow-ups.yml` does, daily and from its Run workflow button. Inside
`check:repo` one malformed issue (#2036) turned every open pull request red at once. Run it
yourself before filing an issue by hand (`--body <path>`, no network) and before pushing a change
that deletes or renames a path an open issue's `Touches:` line names.

## Reading CI: verify the available transport

Use a connected GitHub plugin when available, otherwise authenticated `gh api` or the repository
tracker. Probe once with a read-only request; availability differs by host. Git transport success
does not establish API access. Report an unavailable transport instead of parsing its error body
as an empty successful response. The historical restricted runner is documented in ADR
[20260907-a-runner-registers-the-stack](../architecture/decisions/20260907-a-runner-registers-the-stack.md#context).

A watch exits on positive evidence: a named check on the expected commit reports a terminal
conclusion. Cancellation, missing jobs, API errors and stale commits never count as green. Prefer
a host subscription when supported; otherwise use a bounded watch with failure and timeout exits.
The creator owns stopping it and preserving its run ID in the durable task state.

## The rehearsal a machine runs every night

`pnpm simulate:day` drives a fresh shop through one whole dive day against the built server with
the frozen clock advancing — book, sign, check in, roll call, underway, home, close out, recap — and
fails on the first state the day cannot reach (the machine's half of V-04's rehearsal; see
[docs/engineering/testing.md](../engineering/testing.md#the-one-day-simulation)). It runs nightly
in `.github/workflows/simulate-day.yml`, never on a pull request: it is minutes of serial browser
work, and what it proves decays with other people's merges rather than with your diff. Run it by
hand after a change that touches more than one stage of the day — the booking transaction, the
waiver, the counter, the manifest, the closing block, the recap pass — and read `simulation/day.md`
rather than the runner's output: the transcript names the state and the shop-clock hour, which is
what a failure here is about.

## One validated push per round

Each push to a branch cancels the CI run of the push before it (per-ref concurrency in `ci.yml`).
Measured on 2026-10-10: 9 of the last 25 runs were cancelled that way — runs 4548 to 4551 were four
pushes to one branch in thirty minutes — at about 70 runner-minutes per cancelled full run, against
a 20-job concurrency cap that every other open branch shares. Three speculative pushes buy one CI
answer and cost two runs nobody reads. So push once per round, when the round's work is in.

## The one thing CI cannot answer

Whether the surface looks right. `node scripts/screenshot.mjs <path…>` against a running `pnpm dev`
takes the phone and desktop pair; `node scripts/contact-sheet.mjs` tiles every route in
`scripts/route-coverage.json` at phone width in light into `screenshots/contact-sheet.jpg`, filling
ids and tokens from links it already visited, with `--budget` (60 page loads by default) keeping one
run under the dev supervisor's restart threshold. Screenshots, phone and desktop, are yours — in light only, unless
the work is itself about colour (then `screenshot.mjs --both`); that is the owner's rule,
[H-20260925-many-colour-schemes-check](../product/human-decisions/README.md#decision-register). CI's visual run keeps both schemes, so a
dark pixel that moved still shows up as a diff — but it tells you a pixel *moved*, never that the
new one is better. See the **design-review** and **visual-triage** skills.

The local capture tools wait for a staff page's live session check as well as its loading
skeleton. A session that remains paused or never finishes checking fails the capture with an
explicit error; the tool does not hide the lock screen or save it as evidence of the destination.

## What a focused `pnpm e2e` run does and does not reset

Each invocation derives a deterministic per-worktree base port for its worker-server block; set
`E2E_BASE_PORT` explicitly to override it when coordinating with another process.

Every worker owns a server and a database, and `/api/test/reset` restores the shared `blue-mantis`
fixture's **schedule** before each test — so a spec that cancels a departure, fills a boat, or
edits the catalog leaves nothing behind.

What the reset does *not* restore is the shop's **configuration**: four shop-scoped tables (backup
destination and its deliveries, the WhatsApp sender, media-deletion attempts), every `shops` column
but three, and the shifts and calendar feeds of the permanent staff. The list is `RESET_KEEPS` in
`src/db/delete-path-coverage.test.ts`.

Write one of those and it lands in whichever spec Playwright's sharding runs next in that worker,
which is how a shop ended up briefing for zero minutes, sitting in `America/Cancun`, and
de-indexed from search for the rest of a run.

**So a test that writes shop-wide settings takes a shop of its own.** The lazy `privateShop`
fixture (`e2e/fixtures.ts`) mints a fully seeded one and signs in as its owner, and the next test's
reset purges it (ADR 20260815-per-test-private-shops). Never a `finally` that puts the setting
back: it is a convention nothing enforces, and it does not survive the failure it is there for.
