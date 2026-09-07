# The session hooks, and why each one exists

`.claude/settings.json` wires nine scripts into the lifecycle of a Claude Code session. Every one
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
| `SessionStart` (all sources) | `scripts/session-context.mjs` | prints the checkout's state; after a compaction, the reminders a summary drops; in a cloud container, installs dependencies when `node_modules/` is missing |
| `UserPromptSubmit` | `scripts/session-context.mjs --prompt` | one line: branch, uncommitted count, unpushed count |
| `PreToolUse` on `Bash` | `scripts/guard-bash.mjs` | refuses six command shapes, each naming the correct form |
| `PreToolUse` on `Read` | `scripts/guard-read.mjs` | refuses a generated artifact and a whole-file read of a large source file |
| `PostToolUse` on `Edit`/`Write` | `scripts/format-touched.mjs` | Biome over the one file just touched; hands back what its safe fixes could not clear |
| `PostToolUseFailure` on `Bash` | `scripts/explain-failure.mjs` | attaches the written answer to a failure the debug skill already explains |
| `Stop` | `scripts/stray-processes.mjs` | reports background shells still alive after ten minutes and dev/test processes reparented to init |
| `Stop` | `scripts/unfinished-promises.mjs` | blocks a closing message that promises work while the tree is dirty |
| `Stop` | `scripts/unpushed-work.mjs` | in a cloud container, blocks a plain ending with commits on no remote branch |
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

In a cloud container (`CLAUDE_CODE_REMOTE=true`) with no `node_modules/`, it runs
`pnpm install --frozen-lockfile --prefer-offline`, bounded at four minutes, so the first
`pnpm lint` is not the moment a session discovers there is nothing to run it with.

Nothing here can block, and it prints nothing rather than something wrong: a missing context line
costs a few tokens; an invented branch name costs a wrong push.

## `guard-bash.mjs` — six command shapes this repository has been burned by

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

The guard blanks heredoc bodies and quoted strings before matching, so a commit message or a
script that *mentions* a refused shape is not refused. The cost — a shell-in-a-string like
`sh -c "pnpm test | tail"` going unrefused — is deliberate and one way round only: a false negative
costs one uncaught command, a false positive costs the guard its credibility.

## `guard-read.mjs` — the context-economy rule at the Read tool

Two shapes are refused. A **generated artifact** — `pnpm-lock.yaml`, anything under `drizzle/`
except a migration's own `migration.sql` (the schema-change skill asks for the generated SQL to be
reviewed once), `.next/`, `playwright-report/`, `test-results/` — is never read whole; a specific
lookup goes through Grep, which is what "diagnosing a specific failure in that artifact" means. And
a **whole-file read of a source file over 600 lines** without an `offset` or `limit`: the Read tool
returns up to 2,000 lines when no range is given, so `src/db/schema.ts` at 8,700 lines costs
roughly 25,000 tokens per open and answers a question Grep answers in fifty. An explicit range is
always allowed — a range is a decision, and the guard never second-guesses one. Markdown is exempt
(a document is read to be read; it has no symbol to search for), and so is anything outside the
repository, which is where `node_modules/next/dist/docs/` lives.

The threshold is 600 lines: 170 of the ~2,300 source files are over it, and every one of those is a
file a session reads by symbol, not front to back. `pnpm-lock.yaml` and the env files are also
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

## `unpushed-work.mjs` — a commit on an ephemeral disk is not saved

The container a cloud session runs in is reclaimed after a period of inactivity, and everything
not pushed goes with it. A commit *looks* safe — the work is "saved" — and is not, because the disk
it is saved on is about to be recycled. This is the third `Stop` hook beside the two above:
something finished and then lost. It blocks, once, a plain ending in a cloud container
(`CLAUDE_CODE_REMOTE=true`) while `git rev-list HEAD --not --remotes` is non-empty, naming the
count and the push command. It stays quiet on a laptop, on the re-entry after it already blocked,
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
