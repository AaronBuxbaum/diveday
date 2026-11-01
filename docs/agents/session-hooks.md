# The session hooks, and why each one exists

`.claude/settings.json` wires twelve scripts into the lifecycle of a Claude Code session. Every one
of them exists because a rule written in prose was followed for a while and then was not — a rule
in `AGENTS.md` is only as reliable as the odds that a session holding thirteen thousand words of it
happens to be holding that sentence when it types the command. A hook makes the mechanical half of
a rule mechanical, so the prose can stop being load-bearing and get shorter.

This is the long-form half of one row in [AGENTS.md](../../AGENTS.md)'s command table. Nobody needs
to read it to work here: a refusal names the correct form, a context line says what it is. Read the
section for a hook when you want the reasoning, the escape hatch, or to change it.

Three properties every hook here shares, and a change to one keeps:

- **It fails open.** An unparseable payload, a missing binary, a timeout, its own bug — all exit 0.
  A hook that blocks a session because it broke is worse than the thing it prevents. A `Stop` hook
  also honours `stop_hook_active`, so it can block once and never loop a session against itself.
- **A refusal names the correct form.** A guard that only says no gets routed around, and a
  routed-around guard protects nothing. The "leaves alone" cases in each script's test carry at
  least as much weight as the refusals.
- **Every subprocess is bounded** through `scripts/subprocess.mjs`. A hook runs on every turn, and a
  hook that can hang is the failure the first one was written to report.

Hooks load at session start; a change to one needs a restart to take effect. `pnpm check:agents`
fails when a wired script is missing or a hook script is not wired, and `pnpm agent:health` lists
what is currently wired.

## The events, in the order a session meets them

| Event | Script | What it does |
| --- | --- | --- |
| `SessionStart` (all sources) | `scripts/session-context.mjs` | at startup and resume, fetches `main` and `claude/*` once, then fast-forwards the checkout to `origin/main` when it is the main worktree, clean, detached or on `main`, and has nothing main lacks; prints the checkout's state, the doctor's two-line summary (`scripts/agent-doctor.mjs`, read after the fetch; it names any scheduled workflow whose last two runs on main failed, from one `gh api` read cached an hour in the git common dir by `scripts/scheduled-runs.mjs`, `DIVEDAY_SCHEDULED_RUNS=0` turns it off), "Merge drivers: not installed" when `scripts/merge-drivers.mjs install` could not write them and one line asking for a papercut ([papercuts.md](papercuts.md)) when a guard or hook fights the session; after a compaction, the reminders a summary drops; puts the pinned Node first on PATH when it is installed but not running; in a cloud container, installs dependencies when `node_modules/` is missing or older than the lockfile |
| `UserPromptSubmit` | `scripts/session-context.mjs --prompt` | one line: branch, uncommitted count, unpushed count against the upstream, stack position, and the account's open pull requests (`gh api`, cached ten minutes in the git common dir; `DIVEDAY_OPEN_PULLS=0` turns it off), because one PR's CI runs at a time; on the first prompt of a session, the last session's hook refusals, and "write a papercut" with a ready `file-follow-up.mjs --papercut` command when one rule has refused three or more times this week and no papercut has its slug |
| `PreToolUse` on `Bash` | `scripts/guard-bash.mjs` | refuses eight command shapes, each naming the correct form; writes the quiet reporter into a focused test or e2e run |
| `PreToolUse` on the GitHub MCP's pull request create/update | `scripts/guard-pr-body.mjs` | runs CI's `check-pr-body.mjs` over the body first and refuses one CI would refuse |
| `PreToolUse` on `Read` | `scripts/guard-read.mjs` | refuses a generated artifact and a whole-file read of a large source file |
| `PostToolUse` on `Edit`/`Write` | `scripts/format-touched.mjs` | Biome over the one file just touched; hands back what its safe fixes could not clear |
| `PostToolUseFailure` on `Bash` | `scripts/explain-failure.mjs` | attaches the written answer to a failure the debug skill already explains |
| `Stop` | `scripts/stray-processes.mjs` | reports background shells still alive after ten minutes, dev/test processes reparented to init, and files the session wrote in the directory the checkouts sit in (`*-orig.ts` copies and logs belong in the scratchpad) |
| `Stop` | `scripts/unfinished-promises.mjs` | blocks a closing message that promises work while the tree is dirty, unless its last sentence is a question; the reason quotes the promise in two lines |
| `Stop` | `scripts/unpushed-work.mjs` | in a cloud container, blocks a plain ending with commits on no remote branch; the reason is the one command to run |
| `SubagentStop` | `scripts/stray-processes.mjs` | the same report for a subagent's shells |
| `SessionEnd` | `scripts/stray-processes.mjs --kill` | reaps this session's own shells and orphans — the one moment nobody is left to warn |

## `session-context.mjs` — the state a session would otherwise spend tool calls on

At startup it prints the branch, its upstream and how far ahead or behind, the count of
uncommitted paths, HEAD's subject, and the Node major against the repo's pin. Each of those is
otherwise a tool call in a session's first minute — `git status`, `git log -1`, `git branch -vv`,
`node --version` — and a tool call costs more context than its answer does. On every prompt it
prints the one-line form, which is what makes AGENTS.md's "run `git status` before anything that
touches the shared tree" free and current rather than a snapshot from session start.

After a **compaction** it adds the working rules a summary most reliably drops. Claude Code re-reads
`AGENTS.md` from disk after compaction on its own, but the *state* of a turn — that the task list
is the queue, which checks run before a commit, that follow-ups are issues, that a turn never ends
on an intention — is exactly what a summary compresses into "continued working". Path-scoped rules
reload only as matching files are re-read, so the reminders also say that they exist.

When the running Node is not the major `.nvmrc` pins, it looks for that major under nvm, fnm, n,
volta and `/opt/node<major>`, and when it finds one it appends an `export PATH=…` line to
`CLAUDE_ENV_FILE`, which Claude Code sources before every later shell command; the block says
which Node the session got. When none is installed it says so, and that `node_modules` may then
have been installed under another Node — the fix for that is the environment's own setup, not
this hook.

In a cloud container (`CLAUDE_CODE_REMOTE=true`) with no `node_modules/`, or one older than
`pnpm-lock.yaml` (by `node_modules/.modules.yaml`'s mtime), it runs
`pnpm install --frozen-lockfile --prefer-offline`, bounded at four minutes, so the first
`pnpm lint` is not the moment a session discovers there is nothing — or last week's lockfile — to
run it with.

Nothing here can block, and it prints nothing rather than something wrong: a missing context line
costs a few tokens; an invented branch name costs a wrong push.

**Unpushed is counted against the branch's upstream**, not against every remote ref. A cloud
container's refs are whatever its clone saw: on 2026-10-10 its `origin/main` was five days and 650
commits old, and `git rev-list HEAD --not --remotes` made a detached checkout of a pushed commit
read "650 unpushed commits" on every prompt. A detached HEAD now says "detached HEAD (no upstream)"
and counts nothing; a branch with no upstream yet is still counted against every remote, which is
honest for a branch nobody has pushed. At startup and resume the hook also runs
`git fetch --quiet --prune origin main claude/*` (20 s bound, skipped when `FETCH_HEAD` is under ten
minutes old, `DIVEDAY_SESSION_FETCH=0` to opt out) before reading anything, so `verify:push`,
`check:closing-keywords` and the migration guard measure from a current base, and the
`unpushed-work` hook below sees current remote refs. A failed fetch is said in the block.

**The shared checkout catches up with main.** Every thread loads its hooks and `AGENTS.md` from
the clone the container started with (`/home/claude/diveday`), and nothing moved it: on 2026-10-14
one thread's clone was 659 commits behind and wired 9 hooks against main's 14, so it ran without
the push gate. Right after the fetch, at startup and resume, the hook runs
`git merge --ff-only origin/main` there, and only when nothing can be lost: the main worktree (never
a `git worktree add` one), HEAD detached or on `main`, a clean tree with no untracked files, no
rebase, merge, cherry-pick, revert or bisect in progress, and no commit that is not already on
`origin/main`. Any other state, or any git question that fails, leaves the checkout where it was
and prints nothing; `DIVEDAY_SESSION_FASTFORWARD=0` opts out. It re-reads HEAD just before the
merge and skips when another session moved it since the plan. When it moves, the block says from
and to which commit.

**What it changes under a running session.** Every session in the container runs its hook
scripts from this checkout, and each hook call reads its script from disk, so a fast-forward made
by one session's start changes the scripts every other running session executes from its next
hook call (the hook *list* in `.claude/settings.json` is what each session read at its own
start). The only content it can bring in is a commit already on `origin/main`: nothing local, no
other branch, so only a push to `origin/main` (a merged pull request) can change what those hooks
run.

**The stack position** comes from `scripts/stack-map.mjs`, which derives the layers from the remote
refs (the stacked-prs skill's "Where am I in the stack"). **The doctor's summary** is two lines of
`pnpm agent:doctor`: what it would warn about, and the stack; the full report names each fix.

**Refusals are counted.** Every guard and `Stop` hook that refuses appends one JSON line to the
gitignored `.claude/.hook-log` (`scripts/hook-log.mjs`): when, which session, which hook, the
first line of the reason. The first prompt of the next session reads it back as "N hook refusals
last session (guard-bash 3, …): if one fought you, add a papercut", once, and writes a `noted`
line so it is not repeated. One papercut in 322 commits while twelve commit subjects were pure
format or guard fix-ups is the measurement behind it: the papercuts rule fired on memory, and
memory is what a session does not have about the session before.

## `guard-bash.mjs` — eight command shapes this repository has been burned by

1. **`pnpm <script> -- <args>`.** pnpm forwards that `--` into the underlying command instead of
   consuming it, so vitest/playwright see their own `--` and silently drop every flag after it.
   Nothing errors; the full suite runs. CI's unit shards carry a five-line comment about the run
   where every shard quietly ran the whole suite instead of its quarter.
2. **Bare `git stash` / `git stash pop` / an unlabelled `git stash push`.** The stash stack is shared
   across every worktree and every session on the machine, and `pop` takes whatever is on top. The
   remedy is a WIP commit, or `git stash push -u -m "<tag>"` restored by sha.
3. **A long-running command piped through `tail`/`head`.** Neither can flush, so if the command
   outlives its tool timeout and is moved to the background, its output file stays *empty* rather
   than filling in as it runs. That is the first link in the nine-hour wait-loop of 2026-08-15: a
   `pnpm test` piped through `tail`, backgrounded, watched for a marker that could never arrive.
   Redirect to a file and read the file, or filter with `grep --line-buffered`.
4. **The whole suite, locally.** A bare `pnpm test`, `pnpm e2e`, `pnpm e2e:run`, `pnpm check` or
   `pnpm visual` — or `pnpm exec vitest run` / `pnpm exec playwright test` — with no file, spec or
   narrowing flag. That work belongs to CI's sharded runners: measured 2026-08-28, a full local unit
   run passed twenty minutes without finishing while CI answered in a few, and a saturated box
   starves the dev server, a focused spec and every parallel session
   ([verifying.md](verifying.md)). `--changed`, `--related`, `--shard`, `-t`, `-g`, `--project`
   and `--last-failed` count as focus; `--reporter` does not. The escape hatch, for the rare run
   that is the point, is `DIVEDAY_ALLOW_WHOLE_SUITE=1` written in front of the command.
5. **A generated artifact printed through the shell** — `cat pnpm-lock.yaml`, `head` of anything
   under `.next/`, a Drizzle `snapshot.json` or `_journal.json`, a Playwright report. The Read
   tool's own guard refuses these; this is the same rule at the other door. `grep -n` over the same
   file is the specific lookup AGENTS.md's context-economy rule allows, and is untouched.
6. **A wholesale discard on a dirty tree.** `git reset --hard`, `git checkout .`, `git restore .`
   and `git clean -f` throw away uncommitted work without a trace, and AGENTS.md's Parallel-work
   section assumes some of that work may be another session's. On a clean tree they discard
   nothing and pass; on a dirty one the refusal lists what would be lost. Two push forms are
   refused unconditionally: `git push --force` without `--force-with-lease`, which overwrites a
   commit a reviewer or another session pushed since you fetched, and any push to `main`, which
   skips the pull request.
7. **Cancelling a `push` run on `main`**: `gh run cancel <id>`, or a `gh api` POST to
   `actions/runs/<id>/cancel` or `force-cancel`. A main push run publishes that commit's visual
   snapshot, the baseline every branch cut from it compares against; five were cancelled on
   2026-10-12 and -13 by the account every session's `gh` uses. The run's event and branch are read
   with one `gh api` call; a run it cannot read passes. The GitHub MCP's run tools are not a `Bash`
   command and are outside this hook.
8. **An environment file read through the shell.** `cat`, `grep`, `rg`, `sed`, `awk`, `source` and
   the other readers handed `.env` or a `.env.*` path other than `.env.example`. The settings deny
   the Read tool those files, and `grep`/`find` run without a prompt, so `grep -r . .env.local`
   printed production keys (2026-10-13 review, row 26). `config/env-registry.mjs` says what each key
   is, `.env.example` lists them without values, and `pnpm check:env` says which are blank. This rule
   reads the raw command, not the quote-blanked one the others use: a quoted path, a glob or brace
   expansion (`.env*`, `.env.{local,vercel}`), `dd if=`, and an input redirection all count, and an
   output redirection or heredoc that *writes* the file does not. A recursive search of a directory
   that holds a `.env` file is not caught; `rg` skips it by default as gitignored.

The guard blanks heredoc bodies and quoted strings before matching, so a commit message or a
script that *mentions* a refused shape is not refused. The cost — a shell-in-a-string like
`sh -c "pnpm test | tail"` going unrefused — is deliberate and one way round only: a false negative
costs one uncaught command, a false positive costs the guard its credibility.

It also **rewrites one shape instead of refusing it**: a single focused `pnpm test <file>`,
`pnpm e2e <spec>` or `pnpm e2e:run <spec>` that names no reporter gets `--reporter=dot` (unit) or
`--reporter=line` (e2e) written in before any redirection, through the hook's `updatedInput`. A
refusal would cost a wasted call and a retry for a fix that is purely mechanical. It sets no
`permissionDecision`, so the rewritten command still goes through the normal permission flow, and
it leaves chains, pipes, background jobs and any run that already names a reporter as typed.

There is no push guard. From 2026-10-12 to 2026-10-25 a `PreToolUse` hook refused a `git push`
of a commit `pnpm verify:push` had not stamped; Aaron removed it on 2026-10-25 ("remove the push
guard and the verify:push requirement"). A plain `git push` works, CI is the gate, and a red run
is fixed forward.

## `guard-pr-body.mjs` — the body CI reads, checked before it is sent

Four of the safeguard failures in the same window were pull request bodies: a "Reviews:" paragraph
where the template has `## Reviews launched`, or a reviewer's answer on a sub-bullet. On the GitHub
MCP's `create_pull_request` and `update_pull_request`, this writes the body to a temporary file and
runs `scripts/check-pr-body.mjs` against the base the call names (for an edit, the layer below),
refusing with the checker's own words. It checks only a pull request whose head is the branch
checked out here, since the changed files come from HEAD, and fails open on everything else.

## `guard-read.mjs` — the context-economy rule at the Read tool

Two shapes are refused. A **generated artifact** — `pnpm-lock.yaml`, anything under `drizzle/`
except a migration's own `migration.sql` (the schema-change skill asks for the generated SQL to be
reviewed once), `.next/`, `playwright-report/`, `test-results/` — is never read whole; a specific
lookup goes through Grep, which is what "diagnosing a specific failure in that artifact" means. And
a **whole-file read of a source file over 900 lines** without an `offset` or `limit`: the Read tool
returns up to 2,000 lines when no range is given, so the 8,700-line schema file it was written for
(until 2026-10-07 `src/db/schema.ts`, now a directory) cost roughly 25,000 tokens per open and
answered a question Grep answers in fifty. An explicit range is always allowed — a range is a
decision, and the guard never second-guesses one. Markdown is exempt (a document is read to be read;
it has no symbol to search for), and so is anything outside the repository, which is where
`node_modules/next/dist/docs/` lives.

The threshold is 900 lines: 135 of the ~2,800 source files are over it, and every one of those is a
file a session reads by symbol, not front to back. It was 600 until 2026-10-07, when 242 files sat
over it; the agent-environment audit of that date raised it so a mid-sized module can be read whole. `pnpm-lock.yaml` and the env files are also
denied to the file tools outright in `.claude/settings.json`; the guard is what carries the
*reason* and the alternative.

## `format-touched.mjs` — the lint finding arrives with the edit that caused it

Runs `biome check --write` over the one file an `Edit`/`Write` just touched and, through exit 2,
hands back anything its safe fixes could not clear. Formatting and lint diagnostics are the cheapest
class of failure, and before this hook the repository discovered them in the most expensive place:
at the `pnpm check` gate, minutes later, beside real findings. It runs `check`, not `format`,
because the point is `noUnusedImports` and `noUnusedVariables`, not the whitespace. It refuses a
path outside the repository and stays silent for a file Biome declines (`drizzle/`, canvases, a
file the edit just deleted).

## Formatting is not a commit hook

`format-touched.mjs` formats each file right after an Edit or Write, and CI's lint job is the
backstop for anything that reaches the index another way (a merge, `git checkout <ref> -- <path>`,
a script's output). There is no pre-commit formatter.

## `explain-failure.mjs` — a signpost attached to a known failure

When a `Bash` command fails with an error the debug skill's symptom table already explains — the
dev-server lock, PGlite's data-directory refusal, a `blocking-prerender-*` build error, a
`ECONNREFUSED` on the dev port, `EADDRINUSE`, a missing relation, a fixture timeout — the hook
attaches the one- or two-sentence answer as additional context, pointing at the skill, ADR or
command that holds the rest. The waste it prevents has one shape: a benign, documented failure
starts a diagnostic spiral that reads logs, restarts processes and rediscovers a sentence already
written down. It never blocks and prints nothing when no signature matches, which is almost
always. Add a signature when a failure has caused that spiral twice; the answer stays short.

## `stray-processes.mjs` — the process table is the only honest check

On 2026-08-15 a wait-loop ran for **nine hours**: a `pnpm test` piped through `tail` (which cannot
flush, so its output file stayed empty) was backgrounded, a second task waited on that file for a
success marker with no timeout and no failure branch, and the producer was then killed — leaving a
condition that could never be satisfied. The rule against exactly that loop was already written and
was followed anyway, and **`TaskList` reported "No tasks found" while the shell was alive**, so an
agent that dutifully reaps before ending its turn still misses it. This hook reads the process
table instead: background shells a session spawned that are still alive after ten minutes, plus
dev/test processes reparented to init that nobody will ever reap (two `next-server` processes from
sixteen days earlier, holding 3.6 GB between them, were the first finding). It **reports** at
`Stop` and `SubagentStop`, handing what it finds back to the agent that has to act on it; only
`SessionEnd` runs `--kill`, and `--kill` only ever reaps this session's own shells plus orphans,
never a sibling session's live work. `--list` reports without the non-zero exit.

Three habits none of this can enforce: never pipe a long-running command through `tail`/`head`;
never write a wait whose only exit is a success marker; when you kill a producer, stop its watcher
in the same breath.

## `unfinished-promises.mjs` — a queue in a closing message is not a queue

Written after a session ended three turns running on "now the queued work: dropping the retired
table…" and the user, seeing nothing happen, had to ask whether it was still working. Nothing had
broken; the work never began, because the queue existed only as prose in a message already sent.
The hook reads the turn's closing message and blocks the stop when it promises a next action by
this session ("next I'll", "once that lands") **and** the working tree is dirty — the pair that
means a turn stopped mid-change. It stays quiet for a closing question, for a handoff ("say the
word"), and for a promise on a clean tree, which is the ordinary "finished and pushed, here is what
happens next". The three good endings it names: do it now, file it as a `needs-triage` issue, or
hand it over in as many words.

A block is not free: it re-prompts the session at its full context, $0.10 to $0.30 on a 300k
thread (the 2026-10-14 token review). So a closing question counts as a handoff, but only when it is the
last sentence and that sentence promises nothing ("does B matter? … next I'll do C" still blocks),
and the reason is two lines: the promise quoted back, the
uncommitted count, and "do it now, record it with TaskCreate, or end on a question". The extra turn
should be one tool call or one sentence.

## `unpushed-work.mjs` — a commit on an ephemeral disk is not saved

The container a cloud session runs in is reclaimed after a period of inactivity, and everything
not pushed goes with it. A commit *looks* safe — the work is "saved" — and is not, because the disk
it is saved on is about to be recycled. This is the third `Stop` hook beside the two above:
something finished and then lost. It blocks, once, a plain ending in a cloud container
(`CLAUDE_CODE_REMOTE=true`) while `git rev-list HEAD --not --remotes` is non-empty, naming the
count and the one command to run, `git push -u origin <branch>`, so the extra
full-context turn a block costs is a single tool call. A detached HEAD counts too, against every
remote ref (the fast-forward above leaves the shared checkout detached, after a fetch), and its
reason says to `git switch -c` a branch first. It stays quiet on a laptop, on the re-entry after it already blocked,
when the closing message is a question or a handoff, and when everything is pushed. A session with
a reason not to push says so in its closing message and stops on the next turn.

## What is deliberately not a hook

- **A typecheck after every edit.** `tsc` over this project is tens of seconds; the edit-time
  Biome pass catches the cheap class, and `pnpm typecheck` runs once before a commit.
- **A locale check after editing a bundle.** `en-US` and `es-ES` are edited in sequence, so a hook
  after the first edit would complain about the second one not having happened yet.
  `pnpm check:locale` runs in under a second when the pair is done.
- **Blocking a `Read` of a large file with an explicit range, or a Bash command with the override
  written in front of it.** Both are a session saying it has decided; the guards exist to make the
  cheap path the default, not to argue with a decision.
- **Anything at `PreCompact`/`PostCompact`.** Neither event's output reaches the conversation; the
  post-compaction reminders go through `SessionStart` with the `compact` source instead.
