# AGENTS.md's commands, context economy, parallel work, delegation and hard rules, in full

[AGENTS.md](../../AGENTS.md) is loaded by every session, so it carries each of these as one line:
the rule and the hook or guard that enforces it. This is the full statement each line points at,
with the incident behind it, as it stood in AGENTS.md on 2026-10-07. A rule changed here is changed
in AGENTS.md's one-liner in the same commit.

## Sources of truth

`AGENTS.md`, `.claude/rules/`, `docs/`, scripts and tests are the provider-neutral source of
truth; provider-specific folders are adapters and must not introduce unique requirements. Every
session needs `AGENTS.md` whatever it touches; the path-scoped rules are each the rules and route
map for the paths their `paths:` frontmatter names, and the route-map rows AGENTS.md leaves out are
in [route-map.md](route-map.md).

## Context economy

- Never read `pnpm-lock.yaml`, generated `drizzle/`, `.next/`, `playwright-report/`, or
  `test-results/` whole; Grep them for the one line a diagnosis needs. The session hooks refuse the
  whole-file form at both doors (`Read` and the shell).
- Locate symbols with Grep and read the narrow range; `scripts/guard-read.mjs` refuses a
  whole-file `Read` of a file over 900 lines, and an explicit `offset` or `limit` always passes.
- Read `foo.test.ts` before `foo.ts`: tests are the contract.
- Iterate with one focused test and quiet output. The whole suite belongs to CI; the shell guard
  refuses a bare `pnpm test` / `pnpm e2e` / `pnpm check`.
- Redirect a long run to a scratchpad file, not beside the checkouts, and read the failing part;
  never pipe it through `tail`.

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server at localhost:3000, supervised by `scripts/dev-server.mjs`. Wait for its **`dev: serving … — warmed in Ns`**; Next's `✓ Ready` lands ~26s earlier and means only "listening". The supervisor restarts an OOM-bound `next dev` before the kernel does and says so. One dev server per *checkout*: the lock is `.next/dev/lock`, so `--port` does not buy a second (ADR 20260903-the-dev-server-is-supervised; the **run** skill) |
| `pnpm task:context <area>` | bounded paths, invariants, and validation for a task; with no area, the list of areas |
| `pnpm lint`, `pnpm typecheck`, `pnpm test <file>`, `pnpm e2e:affected`, `pnpm verify:push`, `pnpm e2e <spec>`, `pnpm check` | the pre-commit and pre-push checklist, and which of them CI runs instead, is the **verify** skill; the reasoning is [verifying.md](verifying.md) |
| `pnpm lint:fix` | Biome autofix |
| `pnpm agent:doctor` | Node against `.nvmrc`, `gh`, `origin/main`'s age, `node_modules`, stray processes, remote branches with no open PR and the stack, each with its fix; a row only a human can change (the Node, the branches) is `info` and stays out of the two-line summary the session-start block carries |
| `node scripts/stack-map.mjs` | the stack HEAD is in — layers bottom to top, the top, other tips, merged sub-branches, each layer's paths — derived from remote refs (`--json` for a machine); the per-prompt line carries the position |
| `pnpm stack:sync` | merges this layer's base (`origin/main` for the bottom) into it, read from the open pull requests; stops on a conflict, never pushes, prints what each layer above does (`--plan`, `--chain`; the **stacked-prs** skill) |
| `pnpm check:env` / `pnpm env:manual` | the two structural facts about configuration, and the one file a human edits — see `.claude/rules/infra.md` |
| `pnpm check:repo` | 63 static guards over the repository, spawned concurrently so one run reports every failure rather than the first. Each guard names itself and prints the offending line; the ones whose *why* is not obvious from that message are written up in [docs/agents/repo-checks.md](repo-checks.md) |
| `pnpm check:follow-ups` | every open `needs-triage` issue is still actionable cold. The one guard that calls `gh`, so it is not in `check:repo`: it runs daily in `.github/workflows/follow-ups.yml`, and locally reports **SKIPPED** when `gh` cannot answer ([docs/agents/issue-tracker.md](issue-tracker.md)'s "Filing a follow-up") |
| `pnpm check:context-budget` | the words every session loads before it reads any code — this file, `CLAUDE.md`, any unscoped `.claude/rules/*.md`, and every skill's and reviewer agent's `description:` line — ratcheted (`--write` banks a fall, `--absorb "<why>"` records a deliberate rise), plus a 240-word cap on any single line. The fix for red is never to compress the prose: move the long half into `docs/` or a path-scoped rule and leave a pointer |
| `pnpm check:copy` / `check:domain-strings` / `check:tokens` / `check:architecture` / `check:type-ramp` / `check:voice` / `check:locale` / `check:e2e-hygiene` / `check:route-coverage` / `check:critical-text` / `check:closing-keywords` / `check:rental-fit-caps` | the individual guards, each also inside `check:repo`; the ratcheted ones share `--report <path>` / `--write` / `--absorb`. What each refuses is in the path-scoped rule for the files it reads and in [docs/agents/repo-checks.md](repo-checks.md) |
| session hooks (`.claude/settings.json`) | `scripts/session-context.mjs` (checkout state at start, one line per prompt, the reminders a compaction drops), `scripts/guard-bash.mjs` and `scripts/guard-read.mjs` (`PreToolUse` refusals that name the correct form), `scripts/format-touched.mjs` (Biome over the file just edited), `scripts/guard-commit-format.mjs` (Biome over the staged files before a commit), `scripts/explain-failure.mjs` (a written answer attached to a known failure), and three `Stop` hooks — `scripts/stray-processes.mjs`, `scripts/unfinished-promises.mjs`, `scripts/unpushed-work.mjs`. All fail open. Each one's reasoning and escape hatch: [docs/agents/session-hooks.md](session-hooks.md) |
| `pnpm gates` | report (never a gate): ages of human decisions, every `in-progress` claim checked against `git` (**live** / **stale** / **unverifiable**), and every open `needs-triage` issue oldest first. Nothing it reports is an agent's to close ([docs/agents/issue-tracker.md](issue-tracker.md)) |
| `pnpm agent:health` | report (never a gate): what the agent environment costs and covers — always-loaded context by file, the path-scoped rules and what each costs when it loads, visual coverage of routes, guards with no test beside them, and the hooks wired into the session lifecycle |
| `pnpm build` | production build |
| `pnpm db:generate` | generate a Drizzle migration after editing `src/db/schema/` (the **schema-change** skill) |
| `pnpm db:reset` | clear the dev PGlite database; next `pnpm dev` re-migrates and re-seeds. **Refuses while a dev server is running**, naming the pid (ADR 20260903-one-process-per-pglite-directory) |
| `node scripts/screenshot.mjs <path…>` | look at a page against a running `pnpm dev` — light-mode phone/desktop PNGs into `screenshots/`, with dev-credential sign-in for `/shop/**`. Review-grade captures come from a filtered visual-spec run (the **verify** skill) |
| `pnpm visual` | capture the visual surfaces and compare them against the S3 baseline for this branch's parent commit (baselines are rendered on CI's Linux runners; triage from the CI report) |

Never put a literal `--` before args to a `pnpm` script (`pnpm test -- <file>`): pnpm forwards it,
`vitest`/`playwright` see their own `--` and silently drop every flag after it, and the full suite
runs. Pass args directly. The shell guard refuses the bare form.

## Parallel work

- Assume multiple work scopes can be in flight in this working directory at once — other sessions
  may have uncommitted changes, staged work, or a mid-rebase state. Every prompt opens with the
  branch and the count of uncommitted paths (a hook prints it); read it before anything that
  touches shared working-tree state. The shell guard refuses a wholesale discard (`git reset
  --hard`, `git checkout .`, `git clean -f`) while the tree is dirty.
- **Claim the issue before you start**, the way
  [docs/agents/issue-tracker.md](issue-tracker.md)'s "Claiming an issue" says. A draft PR starts
  too late: a session that has begun and not yet pushed has no footprint at all. Clear the label
  when you finish or stop; a claim nothing backs expires on the daily follow-ups run.
- Before starting non-trivial work, read the open PRs **and** `pnpm gates`' "Claimed — in flight"
  section. Overlap with your plan → pick a different slice or coordinate in that thread. A claim
  reported **stale** is a dead session, not a reservation — take the work and clear the claim.
- **Create a worktree from the shell** (`git worktree add -B <branch> <path> <base>`), never with
  the `EnterWorktree` tool: its permission prompt parks the thread until a human answers, and on
  2026-10-13 that held a 328k-token thread all night.
- **Never switch a live thread's model; start a fresh thread with a state note instead.**
  Switching drops the prompt cache, so the next call re-reads the whole context at full price
  (H-117).
- Never bare `git stash` / `git stash pop` — one stack shared with every worktree and every session
  (the shell guard refuses both). Prefer a `git worktree`, then a WIP commit, then
  `git stash push -u -m "<tag>"` restored by sha and popped immediately after.
- Use a unique branch slug and open a draft PR early for non-trivial concurrent work; state owned
  paths, expected schema changes, and planned ADR ids in its description. New ADRs use
  collision-resistant `YYYYMMDD-short-slug` ids; do not allocate the next integer. No branch-local
  reservation ledgers. Split work by vertical slice or non-overlapping paths, and trial-merge the
  target branch before calling work complete.
- **Stack everything, across threads, and run one PR's CI at a time: cut every branch from the
  newest open one, any thread's, related or not, as a draft with `base` on it; the thread that owns
  the stack pushes one layer at a time, because overlapping runs queue on a 20-job cap.** That is
  Aaron's rule; the CI half dates from 2026-10-12, when 15 to 19 layers pushed together cost 126
  cancelled runs and 90 failed jobs. Push a layer, let its run finish, then push the next; a thread
  whose layer sits on another thread's stack leaves the push order to the thread that owns it. A
  batch goes up in rounds of about 150 changed files at most, each green before the next; a fix
  push carries only the fix (#2934). A dependent chain (`src/db/schema/` + migration → the `src/db` reader → the surface) has no other
  honest shape; unrelated work stacks because a second branch cut from `main` re-edits the same
  shared files (a `check:repo` row, a baseline, a message bundle), and on a stack those merge once,
  while the change is being written. Pixels are not an exception. Cut each branch from the one
  below, open each PR as a **draft at its first commit** with `base` set to that branch, bottom one
  first, every body naming its position; `.github/workflows/stack.yml` registers the chain as a
  GitHub stack. Never open the parts as independent PRs off `main`. Every layer runs the whole CI
  gate.
  What still goes on its own branch off `main` (no stack open, or a fix that must merge now — never
  depth: a stack has no cap, and a long one is the point) and the
  mechanics are in the **stacked-prs** skill and ADRs 20260821-stacked-pull-requests,
  20261003-every-stack-layer-runs-ci and 20260907-a-runner-registers-the-stack.
- **Push less often.** A push cancels the PR's run in flight; cancelled runs were about half of PR
  CI compute (2026-11-01 profile). Batch fixes into one push, hold a stacked layer's push until
  the layer below is green, and push a stack cascade once.
- Before fixing a failing or flaky test, search open PRs for one that already touches the same spec
  or test name; coordinate in that thread instead of pushing a competing fix.
- **A thread builds one layer itself; parallel layers go to fresh workers.** A single layer or a
  small change is built in the thread that understands it, because a handoff loses detail and
  adds latency (Aaron, 2026-10-24, after Anthropic's article in [Delegating](#delegating)). When
  the work has independent layers that can run in parallel, or would push the thread past about
  150k tokens, the thread steers instead: it hands each ticket or layer to a fresh worker (a
  subagent, or a new thread) with a spec written from [spec-template.md](spec-template.md): goal,
  files owned, constraints, done-when, verification command, hand-back format. The worker builds,
  writes its result to a file and hands back the path; the steering thread reads that file, not
  the tree, and leaves CI logs and visual triage to a worker too. A thread whose context passes about
  150k tokens writes a state note (what is done, what is in flight and where, the next step) and
  retires, and a fresh thread picks up from the note. The measurement: on 2026-10-14 five
  steering threads at 200k to 380k context were also building, one with fourteen branches and
  another with six worktrees, each call paying for the whole history; a long session degrades
  as its input grows, and a clean one with a better brief outperforms it.

## Delegating

- **Scale the effort to the task.** A one-file change gets no plan and no subagent. A multi-file
  change gets a plan first. A cross-area change gets at most three parallel subagents, each given
  an objective, an output format and a boundary (the paths it may read or change). One turn here
  once spawned nine; most coding work has fewer independent parts than that.
- **The main loop is the default; a subagent needs a reason.** One context that loads skills as it
  needs them connects results across steps that a handoff loses, and runs faster
  ([Anthropic, "When to fold subagents into your main agent loop"](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)).
  Delegate only for one of three reasons: the input would bloat the context (long logs, CI output,
  screenshots, a sweep across many files), the parts are independent and run in parallel with a
  context you can throw away, or an independent read is the point (the reviewer agents, which must
  not inherit the author's reasoning). "It is a different area" is not a reason.
- **Split by context, never by problem type.** A worker gets work that needs little from the rest
  of the task and returns a compact result. Steps that chain on each other's output or share data
  stay in one context: a scout whose notes an implementer must re-read, or a merger that reads what
  an implementer wrote, is a lossy relay of the same facts. A finding the agent must *experience*
  (friction, a confusing flow) is reported by the agent that experienced it.
- **A procedure is a skill, not an agent.** New know-how goes into `.agents/skills/` with a
  description that says when it applies, so the main loop loads it on demand. A new
  `.claude/agents/` definition is only for a read that needs a fresh, unanchored context; it needs
  an owner, a narrow tool list and a compact output.
- **Route cheap work to a cheap model.** Scouting and search go to the read-only `Explore` agent
  (`.claude/agents/Explore.md`). Screenshot capture and test execution need an execution-capable
  worker; never assign shell commands or file output to a read-only scout. Design,
  judging and safety-critical code stay on the main model.
- **Check the budget before fanning out.** Before starting workers or reviewers, a coordinator that
  can read its 7-day usage status (`rate_limit_info`) does so. At the warning status it runs one
  thread at a time; when the limit is rejected it starts no worker.
- **A worker hands back a path.** A subagent or worker writes its full result to a file (the
  scratchpad, or `docs/` when the result is the deliverable) and hands back the path plus at most
  ten lines. A hand-back is read twice in the parent's transcript, and a long one crowds out the
  work; the next step reads the file.

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
- **Verify before commit, and let CI run anything whole.** The checklist is the **verify** skill,
  and nowhere else; the line between what you run and what CI runs, and why, is
  [docs/agents/verifying.md](verifying.md). Nothing gates a push: a plain `git push` works, CI is the gate, and a red run is fixed forward (Aaron, 2026-10-25: "remove the push guard and the verify:push requirement"). `pnpm verify:push --quick` is an optional local run when you want an answer before CI's. Push once per round: each
  push cancels the CI run of the one before. Open the PR before it is green when that is the
  fastest way to learn what is broken, say in the body what you ran and what you did not, and work
  what comes back — a red PR you are driving is fine, a red PR you have stopped driving is not.
  Never report unverified work as done, and *look at* UI you changed, the one thing CI cannot
  answer.
- **A thought you don't act on goes in the tracker or the PR, never only in your closing
  message.** A bug, a safety gap, or a decision only a human can make: a GitHub issue labelled
  `needs-triage` ([docs/agents/issue-tracker.md](issue-tracker.md)'s "Filing a follow-up"), its
  number in the PR description, written for a reader with none of your context and ending in a
  prompt they can paste into a fresh session. An idea or feature with a concrete first step is an
  `idea` issue (`file-follow-up.mjs --idea`), kept out of every ready-for-* sweep. Anything else (debt read in passing, an
  out-of-scope cleanup) is a bullet in one "Notes" comment on the PR. This never replaces doing the work you were asked to do, a failing
  test is never a follow-up, and someone else's entry is never a drive-by.
- **A failing or flaky test is part of the work, even when unrelated to your change.** Fix it
  before calling the work done — never skip it, widen a timeout to paper over a flake, or leave it
  red for someone else. Check **Parallel work** first for an in-flight fix on the same test. The
  one exception is a **proven** flake (it failed and passed on one sha with no code change, or
  failed in the nightly flake hunt): it may be quarantined instead, with an open `needs-triage`
  issue and an expiry at most 7 days out, at most 3 at once (`@quarantine`,
  [testing.md](../engineering/testing.md#what-runs-when)'s "Flakes"; `check:e2e-hygiene`). It
  then runs nightly only, and its expiry turns every branch red. "Fix any flake you meet" stalled
  unrelated PRs on someone else's flake (test review decision 4, 2026-10-14).
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
- **A new feature a shop could run without gets a Features switch (default on), or a `core`
  entry saying why not** (Aaron, 2026-10-23). The switch is a `shops` boolean in
  `SHOP_FEATURES` (`src/lib/shop-features.ts`) with a row on Settings → Features
  (`settings/features/feature-rows.ts`); off hides every door to it and deletes nothing. The
  answer is recorded once in `src/lib/feature-coverage.ts`: every staff destination (a
  `Record`, so an unclassified one fails typecheck) and every boolean on `shops`
  (`feature-coverage.test.ts` names any it does not know). A destination mapped to a switch
  (or to several, `{ anyOf }`, when one page holds more than one feature) leaves the nav, the
  section tabs and ⌘K while it is off; its page redirects, and every other
  entry point (Today rows, emails, crons, public pages) reads the same column.
- **New runtime dependency → ADR** (`pnpm check:adrs`). New domain concept → glossary
  (`pnpm check:glossary`). Invalidated doc → fix in the same PR (`pnpm check:docs`).
- **Safety-critical surfaces** (manifests, roll call, readiness and cert gating, medical
  flags and the waiver state they are read from, nitrox fill authorization and the prep list's
  air/nitrox split, erasure) get boring code, failure-path and adversarial tests, and a `dive-domain-expert` review,
  named in the PR body's "Reviews launched" section, which CI reads
  ([repo-checks.md](repo-checks.md#pr-body)). On every one of these surfaces that review is **two independent runs with different framing**, launched in parallel
  so neither sees the other: one as **a dock operator** (the boat is leaving, the count is
  called, the diver is at the rail — what does this code let happen?) and one as **an attacker**
  (`security-reviewer` when the change touches personal or medical data, tokens or erasure;
  otherwise a second `dive-domain-expert` run told to break the rule rather than check it).
  Act on the union of their findings, each under the reviewers' evidence rule: it cites the
  rule, ADR or glossary line it violates and a failing input or a test, labelled confirmed or
  possible. A finding is acted on once its test runs and fails. Both runs are named in "Reviews
  launched" (CI checks that the agent is named, not that it ran twice). Ordinary PRs, plain
  waiver signing and rental fit keep one run: two runs double the review
  spend, and the voting is worth it only where a miss puts a diver in the water.
- **Security-sensitive changes** (auth/authz, token flows, rows holding personal or medical data,
  export/import) get a `security-reviewer` review before merge, named in the same "Reviews
  launched" section (`scripts/check-pr-body.mjs`).
- **Layout**: domain logic in `src/lib/` or a feature module; routes in `src/app/` stay thin; e2e
  specs live in `e2e/`. The dependency direction is one way — `app → features → lib/db` — and
  `pnpm check:architecture` enforces it.
- **Tests travel with behavior.** New features include happy-path and important failure-path
  tests; bug fixes begin with a failing regression test. Which layer each test belongs to is
  [testing.md](../engineering/testing.md#how-a-change-decides-its-tests)'s six-step list, and the
  browser floor is its [critical journeys](../engineering/testing.md#critical-journeys) table,
  which `pnpm check:critical-journeys` holds. It replaced "every important flow gets a spec, every
  important surface a capture" (test review decision 2, 2026-10-14), which grew ten-plus "add
  captures" issues by rule while ranking no walk above another. A spec finds elements by role and
  message key, never a sentence (`check:e2e-hygiene`'s long-literal ratchet).
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
