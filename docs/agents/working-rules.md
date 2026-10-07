# AGENTS.md's commands, parallel work and hard rules, in full

[AGENTS.md](../../AGENTS.md) is loaded by every session, so it carries each of these as one line:
the rule and the hook or guard that enforces it. This is the full statement each line points at,
with the incident behind it, as it stood in AGENTS.md on 2026-10-07. A rule changed here is changed
in AGENTS.md's one-liner in the same commit.

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server at localhost:3000, supervised by `scripts/dev-server.mjs`. Wait for its **`dev: serving … — warmed in Ns`**; Next's `✓ Ready` lands ~26s earlier and means only "listening". The supervisor restarts an OOM-bound `next dev` before the kernel does and says so. One dev server per *checkout*: the lock is `.next/dev/lock`, so `--port` does not buy a second (ADR 20260903-the-dev-server-is-supervised; the **run** skill) |
| `pnpm task:context <area>` | bounded paths, invariants, and validation for a task |
| `pnpm check:env` / `pnpm env:manual` | the two structural facts about configuration, and the one file a human edits — see `.claude/rules/infra.md` |
| `pnpm check:repo` | 44 static guards over the repository, spawned concurrently so one run reports every failure rather than the first. Each guard names itself and prints the offending line; the ones whose *why* is not obvious from that message are written up in [docs/agents/repo-checks.md](repo-checks.md) |
| `pnpm check:follow-ups` | every open `needs-triage` issue is still actionable cold. The one guard that calls `gh`, so it is not in `check:repo`: it runs daily in `.github/workflows/follow-ups.yml`, and locally reports **SKIPPED** when `gh` cannot answer ([docs/agents/issue-tracker.md](issue-tracker.md)'s "Filing a follow-up") |
| `pnpm check` | repository safeguards + lint + typecheck + unit tests, concurrently and fail-slow (`scripts/check-all.mjs`) — **the bar, and CI is where you clear it**. Locally, run its four halves: `pnpm check:repo`, `pnpm lint`, `pnpm typecheck`, `pnpm test:changed` ([docs/agents/verifying.md](verifying.md)) |
| `pnpm check:context-budget` | the words every session loads before it reads any code — this file, `CLAUDE.md`, any unscoped `.claude/rules/*.md`, and every skill's and reviewer agent's `description:` line — ratcheted (`--write` banks a fall, `--absorb "<why>"` records a deliberate rise), plus a 240-word cap on any single line. The fix for red is never to compress the prose: move the long half into `docs/` or a path-scoped rule and leave a pointer |
| `pnpm check:copy` / `check:domain-strings` / `check:tokens` / `check:architecture` / `check:type-ramp` / `check:voice` / `check:locale` / `check:e2e-hygiene` / `check:route-coverage` / `check:critical-text` / `check:closing-keywords` / `check:rental-fit-caps` | the individual guards, each also inside `check:repo`; the ratcheted ones share `--report <path>` / `--write` / `--absorb`. What each refuses is in the path-scoped rule for the files it reads and in [docs/agents/repo-checks.md](repo-checks.md) |
| session hooks (`.claude/settings.json`) | `scripts/session-context.mjs` (checkout state at start, one line per prompt, the reminders a compaction drops), `scripts/guard-bash.mjs` and `scripts/guard-read.mjs` (`PreToolUse` refusals that name the correct form), `scripts/format-touched.mjs` (Biome over the file just edited), `scripts/explain-failure.mjs` (a written answer attached to a known failure), and three `Stop` hooks — `scripts/stray-processes.mjs`, `scripts/unfinished-promises.mjs`, `scripts/unpushed-work.mjs`. All fail open. Each one's reasoning and escape hatch: [docs/agents/session-hooks.md](session-hooks.md) |
| `pnpm gates` | report (never a gate): ages of human decisions, every `in-progress` claim checked against `git` (**live** / **stale** / **unverifiable**), and every open `needs-triage` issue oldest first. Nothing it reports is an agent's to close ([docs/agents/issue-tracker.md](issue-tracker.md)) |
| `pnpm agent:health` | report (never a gate): what the agent environment costs and covers — always-loaded context by file, the path-scoped rules and what each costs when it loads, visual and axe coverage of routes, guards with no test beside them, and the hooks wired into the session lifecycle |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | tsc |
| `pnpm test <file> --reporter=dot` | focused Vitest run with low-noise success output |
| `pnpm test:changed` | the tests your diff reaches through the import graph — the pre-push net that catches a coverage guard living in a file you never touched. A `src/db/schema.ts` edit widens it to the whole suite; name the three guards by path instead ([docs/agents/verifying.md](verifying.md)) |
| `pnpm e2e <spec> --reporter=line` | build, then run one Playwright spec — focused because the **whole** suite belongs to CI. What the per-test reset does and does not restore, and why a test that writes shop settings takes a `privateShop`: `.claude/rules/e2e.md` |
| `pnpm e2e:run <spec> --reporter=line` | fast-iteration path: build once with `pnpm e2e:build`, then reuse it |
| `pnpm build` | production build |
| `pnpm db:generate` | generate a Drizzle migration after editing `src/db/schema.ts` (the **schema-change** skill) |
| `pnpm db:reset` | clear the dev PGlite database; next `pnpm dev` re-migrates and re-seeds. **Refuses while a dev server is running**, naming the pid (ADR 20260903-one-process-per-pglite-directory) |
| `node scripts/screenshot.mjs <path…>` | look at a page against a running `pnpm dev` — light-mode phone/desktop PNGs into `screenshots/`, with dev-credential sign-in for `/shop/**`. Review-grade captures come from a filtered visual-spec run (the **verify** skill) |
| `pnpm visual` | capture the visual surfaces and compare them against the S3 baseline for this branch's parent commit (baselines are rendered on CI's Linux runners; triage from the CI report) |

Never put a literal `--` before args to a `pnpm` script (`pnpm test -- <file>`): pnpm forwards it,
`vitest`/`playwright` see their own `--` and silently drop every flag after it, and the full suite
runs. Pass args directly: `pnpm test <file> --reporter=dot`. The shell guard refuses the bare form.

## Parallel work

- Assume multiple work scopes can be in flight in this working directory at once — other sessions
  may have uncommitted changes, staged work, or a mid-rebase state. Every prompt opens with the
  branch and the count of uncommitted paths (a hook prints it); read it before anything that
  touches shared working-tree state. The shell guard refuses a wholesale discard (`git reset
  --hard`, `git checkout .`, `git clean -f`) while the tree is dirty.
- **Claim the issue before you start.** Add the `in-progress` label and post a `## Claim` comment
  naming your branch, worktree, start time, and owned paths — see
  [docs/agents/issue-tracker.md](issue-tracker.md)'s "Claiming an issue". A draft PR
  starts too late: a session that has begun and not yet pushed has no footprint at all. Clear the
  label when you finish or stop.
- Before starting non-trivial work, read the open PRs **and** `pnpm gates`' "Claimed — in flight"
  section. Overlap with your plan → pick a different slice or coordinate in that thread. A claim
  reported **stale** is a dead session, not a reservation — take the work and clear the claim.
- Never bare `git stash` / `git stash pop` — one stack shared with every worktree and every session
  (the shell guard refuses both). Prefer a `git worktree`, then a WIP commit, then
  `git stash push -u -m "<tag>"` restored by sha and popped immediately after.
- Use a unique branch slug and open a draft PR early for non-trivial concurrent work; state owned
  paths, expected schema changes, and planned ADR ids in its description. New ADRs use
  collision-resistant `YYYYMMDD-short-slug` ids; do not allocate the next integer. No branch-local
  reservation ledgers. Split work by vertical slice or non-overlapping paths, and trial-merge the
  target branch before calling work complete.
- **Stack by default: cut every branch from the branch you opened last, not from `main`, whenever
  that one is still open** — related or unrelated, a schema migration or a padding change. A
  dependent chain (`src/db/schema.ts` + migration → the `src/db` reader → the surface) has no other
  honest shape; unrelated work stacks because a second branch cut from `main` re-edits the same
  shared files (a `check:repo` row, a baseline, a message bundle), and on a stack those merge once,
  while the change is being written. Pixels are not an exception. Cut each branch from the one
  below, open each PR as a **draft at its first commit** with `base` set to that branch, bottom one
  first, every body naming its position; `.github/workflows/stack.yml` registers the chain as a
  GitHub stack. Never open the parts as independent PRs off `main`. Every layer runs the whole CI
  gate.
  What still goes on its own branch off `main` (nothing of yours open, a fix that must merge now,
  another session's branch — never depth: a stack has no cap, and a long one is the point) and the
  mechanics are in the **stacked-prs** skill and ADRs 20260821-stacked-pull-requests,
  20261003-every-stack-layer-runs-ci and 20260907-a-runner-registers-the-stack.
- Before fixing a failing or flaky test, search open PRs for one that already touches the same spec
  or test name; coordinate in that thread instead of pushing a competing fix.

## Hard rules

- **A background job you start is yours to end, and `TaskList` is not how you check.** On
  2026-08-15 a wait-loop ran for **nine hours** here while `TaskList` reported "No tasks found".
  `node scripts/stray-processes.mjs --list` reads the process table, which is the only honest
  answer; the `Stop` hook runs it for you. Never pipe a long-running command through `tail`/`head`
  (neither can flush — the shell guard refuses it); never write a wait whose only exit is a success
  marker; when you kill a producer, stop its watcher in the same breath. A CI watch built on `curl`
  against `api.github.com` is the same failure wearing a different hat — repo-scoped REST is
  refused here, and an empty response reads as green
  ([docs/agents/verifying.md](verifying.md)).
- **Verify before commit, and let CI run anything whole.** Targeted checks are yours — the one
  guard you touched, `pnpm test <file>`, `pnpm typecheck`, `pnpm lint`, one focused
  `pnpm e2e <spec>`, and **before you push** `pnpm test:changed`, the only one that reaches a
  coverage guard living in a file you did not edit. The **whole** unit suite, `next build`, the
  whole e2e suite and the visual run go to CI: push and read the result. Open the PR before it is
  green when that is the fastest way to learn what is broken, say in the body what you ran and what
  you did not, and work what comes back — a red PR you are driving is fine, a red PR you have
  stopped driving is not. Never report unverified work as done, and *look at* UI you changed
  (screenshots, light only unless the work is colour), the one thing CI cannot answer
  ([docs/agents/verifying.md](verifying.md)).
- **A thought you don't act on goes in the tracker, not in your closing message.** An idea left
  undone, a question only a human can answer, a risk noticed in passing, a cleanup deliberately
  scoped out: a GitHub issue labelled `needs-triage`
  ([docs/agents/issue-tracker.md](issue-tracker.md)'s "Filing a follow-up"), its number
  in the PR description, written for a reader with none of your context and ending in a prompt they
  can paste into a fresh session. This never replaces doing the work you were asked to do, a failing
  test is never a follow-up, and someone else's entry is never a drive-by.
- **A failing or flaky test is part of the work, even when unrelated to your change.** Fix it
  before calling the work done — never skip it, widen a timeout to paper over a flake, or leave it
  red for someone else. Check **Parallel work** first for an in-flight fix on the same test.
- **A pushed PR is not done until visual diffs are accounted for.** Review every diff image for
  what the code explains; never wave a mismatch through. Baselines live in S3 keyed by git commit
  (ADR 20260729-reg-suit-visual-regression), so "approving" an intentional change means saying in
  the PR *why* the pixels moved and merging. See the **visual-triage** skill.
- **A pushed PR is not done until its review threads are answered.** Every PR is reviewed within
  minutes by `sourcery-ai` and `github-advanced-security`, and by Aaron when he gets to it. Read
  the threads before you call the work done and again whenever you return to a branch. Every open
  thread ends in one of three states, never silence: **fixed** (push, reply naming the commit),
  **declined** (the reason in the thread — a nitpick that contradicts a written rule is declined by
  naming the rule), or **filed** (a `needs-triage` issue whose number goes in the thread). Reply on
  the thread, resolve only what you acted on, and leave a question open. In the cloud containers
  `gh` is absent: use the GitHub MCP's `pull_request_read` (method `get_review_comments`, which
  reports `is_resolved`), `add_reply_to_pull_request_comment` and `resolve_review_thread`; the
  `gh` forms are in [docs/agents/issue-tracker.md](issue-tracker.md). **No comments does
  not mean reviewed clean** — `coderabbitai` reviews nothing here — and a bot's comment is never
  automatically right: these tools do not know this repository's rules.
- **New runtime dependency → ADR.** New domain concept → glossary. Invalidated doc → fix in the
  same PR.
- **Safety-critical surfaces** (manifests, roll call, cert gating, medical flags) get boring code,
  failure-path and adversarial tests, and a `dive-domain-expert` review.
- **Security-sensitive changes** (auth/authz, token flows, rows holding personal or medical data,
  export/import) get a `security-reviewer` review before merge.
- **Layout**: domain logic in `src/lib/` or a feature module; routes in `src/app/` stay thin; e2e
  specs live in `e2e/`. The dependency direction is one way — `app → features → lib/db` — and
  `pnpm check:architecture` enforces it.
- **Tests travel with behavior.** New features include happy-path and important failure-path
  tests; bug fixes begin with a failing regression test. Every important **flow** a user runs gets
  an `e2e/` spec, and every important **surface** they look at gets a capture in
  `e2e/visual.spec.ts` (the **e2e-and-visual** skill; if unsure whether something qualifies, it
  does).
- **Copy comes from a message bundle, never a component; every sentence earns its place, or it is
  deleted; every delete is soft and the word on screen is still "Delete"; a rendered date names its
  zone and never a hard-coded locale; time is read through the clock; a new page ships with a
  `loading.tsx`.** Each of these is stated in full, with its incident and its guard, in the
  path-scoped rule for the files it governs — `.claude/rules/surfaces.md`, `i18n.md`, `db.md`,
  `domain.md` — and `pnpm check:repo` enforces the mechanical half of every one.
- **There is no legacy. Delete it.** DiveDay is pre-pilot (H-49): a table nothing writes is
  dropped, a code path that only tolerates old rows is deleted, and no reconciliation, backfill,
  dual-read or version-tolerance code is written for pre-pilot data. The two things this does not
  relax — the destructive-migration guard and H-02's retention and erasure promises — and the rule's
  expiry are in `.claude/rules/db.md`.
- **Text a human will copy is written unwrapped** — one line per paragraph and per bullet, in a
  document and in a chat reply alike; the worked examples are in `.claude/rules/docs.md`.
- **A queue in a closing message is not a queue.** Ending a turn with "next I'll drop the retired
  table" starts nothing: the message is sent, the turn ends, and the next turn has only what is
  written down. A turn ends in exactly one of three states: the thing is **done**, it is **filed**
  as a `needs-triage` issue, or it is **handed over** in as many words. A turn that ends on a
  question is a fine ending; one that ends on an intention is not. More than one item in flight
  goes in the task list (`TaskCreate`/`TaskUpdate`), never in prose. Two `Stop` hooks hold this
  line — `scripts/unfinished-promises.mjs` blocks a promise on a dirty tree, and in a cloud
  container `scripts/unpushed-work.mjs` blocks a plain ending with commits on no remote branch,
  since the container is reclaimed and the commits go with it.
- **Secrets never enter the repo** — `.env*` is gitignored, and `.claude/settings.json` denies the
  generated env files, `.pglite/`, and key material to the file tools.
