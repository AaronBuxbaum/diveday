# Where a check runs: your container, or CI

The short rule is in [AGENTS.md](../../AGENTS.md)'s hard rules. This is the reasoning, and the
line between the two.

## Run locally: anything you can scope to the change

- the one guard you touched — `node scripts/check-<name>.mjs`
- `pnpm test <file> --reporter=dot`, and — **before you push** — `pnpm test:changed`, which selects
  by import graph and so reaches the coverage guards a focused run structurally cannot (see below)
- `pnpm typecheck` and `pnpm lint`, both of which are seconds
- `node scripts/check-repo.mjs` when you touched something a static guard reads — it is
  concurrent and finishes in under a minute
- one focused spec: `pnpm e2e <spec> --reporter=line`, or `pnpm e2e:run <spec>` after one
  `pnpm e2e:build`
- `node scripts/screenshot.mjs <path…>` against a running `pnpm dev` — looking at UI you changed
  is not optional and has no CI substitute

## The guards that live in files you will never edit

A focused `pnpm test <file>` runs the tests you can name. The **coverage guards** are the ones you
cannot: `src/db/export.test.ts`, `src/db/diver-merge.test.ts`, `src/db/delete-path-coverage.test.ts`
and `src/db/retention.test.ts` assert over `src/db/schema.ts` from files whose whole job is to
notice something you added
*elsewhere*. Nothing you touch selects them, so they go red on CI instead — four times in one
afternoon on 2026-09-05: slice 16g's four columns, 16i's `recap_pulses` table and its
`addressed_by_person_id`, and 16j-B's two `person_id` columns. Every one of those agents had run
the documented local gate correctly.

`pnpm test:changed` selects by import graph and catches all four, which is why it is a pre-push
step rather than a mid-iteration convenience. Know its cost before you start it: `schema.ts` sits
in nearly every import chain, so a diff touching it selects the **whole** suite — 9,391 of 9,391
entries, measured 2026-09-06 — and on a stack the diff against `origin/main` is every layer
beneath you, so that is a floor rather than a ceiling. That run belongs to CI. When you touched
`schema.ts`, name the four by path instead:

```bash
pnpm test src/db/export.test.ts src/db/diver-merge.test.ts src/db/delete-path-coverage.test.ts src/db/retention.test.ts --reporter=dot
```

40 tests, about a minute, and it catches every failure listed above. The trigger is touching
`schema.ts` at all — 16j-B added only columns and tripped two guards.

## Push and read CI: anything whole

`pnpm check`'s unit phase, the whole unit suite, `next build`, the whole `e2e/` suite, and the
visual run.

**Why.** CI shards the unit suite four ways across dedicated runners and runs lint, typecheck,
build, the safeguards and the Playwright shards beside it, in parallel. One agent container runs
the same work serially on four cores. Measured on 2026-08-28: a full local unit run passed twenty
minutes without finishing, at a load average above eight, while CI answered the same question in
a few. Worse than the wait is what it does to everything else — a saturated box starves the dev
server, a focused spec, and any parallel session sharing the machine.

**So the PR is the instrument, not the trophy.** Open it before it is green when that is the
fastest way to learn what is broken; say so in the body, name what you have and have not run, and
work what comes back. This does not license pushing carelessly: a push that turns CI red costs a
cycle and reviewers' trust, so the local checks above still run first, and a change you have
reason to think is broken gets fixed before it goes.

**And a red PR is a PR you are still driving.** The licence to push before green is a licence to
find out, never to walk away. A pull request left red with nobody working it is the thing this
rule must not become — see AGENTS.md's rules on visual diffs and review threads, which apply from
the moment it is open.

## Reading CI: through the MCP, or not at all

GitHub is reachable from a cloud container **only** through the MCP server tools. `gh` is not
installed, and the agent proxy answers every repo-scoped `api.github.com` call with a 403 whose body
is `GitHub access is not enabled for this session` — with a token or without, measured identically.
The table is in ADR
[20260907-a-runner-registers-the-stack](../architecture/decisions/20260907-a-runner-registers-the-stack.md#context).
`git ls-remote origin` *does* work, because the git proxy is authenticated separately, so "git
reaches GitHub, therefore the API does" is the wrong inference and the easy one to make.

What that costs is not an error. On 2026-09-07 four CI monitors polled `.../check-runs` with `curl`.
A 403 body has no `check_runs` key, so each parse yielded nothing and none of them threw; every loop
exited on the *absence* of failures, which an empty response satisfies perfectly. One reported **CI
COMPLETE** while the run was still going; three timed out while CI finished normally. Four wrong
answers, no error anywhere.

So: **make a watch's exit condition a positive fact — a named check reporting a conclusion — never
the absence of a negative.** A loop that stops when it sees no failures stops on a broken request,
an empty page, and a typo in a field name, and cannot tell any of them from success.

Better still, do not watch. `subscribe_pr_activity` delivers review comments, CI failures and
check-suite rollups into the session on their own, and ending the turn is how you wait for them —
so most CI polling here is unnecessary as well as unreliable. `node scripts/stray-processes.mjs
--list` labels a shell whose command this container refuses, whatever its age.

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

## The one thing CI cannot answer

Whether the surface looks right. Screenshots, light and dark, phone and desktop, are yours — the
visual run tells you a pixel *moved*, never that the new one is better. See the **design-review**
and **visual-triage** skills.

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
