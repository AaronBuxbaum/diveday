# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues (`AaronBuxbaum/diveday`). Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Filing a follow-up

Where an agent leaves the things it thought of but did not do: the idea the change suggested, the
question only a human can answer, the risk it found in passing, the cleanup it deliberately left
out of scope. One GitHub issue per item, labelled `needs-triage`, so parallel sessions never
collide on the same file the way an append-to-me register would.

This used to be a file-based register (`docs/product/follow-ups/`, ADR 20260808-agent-follow-up-register).
It moved onto the issue tracker already used for specs and bugs (ADR 20260821-follow-ups-are-github-issues)
rather than staying a second, repo-local system: Aaron triages both from the same place, and a
follow-up that gets accepted becomes an ordinary tracked issue in the same tool instead of a second
migration step.

### When

You are finishing a change and you have any of these:

- an improvement you can see but that is outside the scope you were given
- a question whose answer would change what you built (policy, pricing, tone, dive-safety practice)
- a risk, latent bug, or piece of debt you noticed while reading nearby code
- a decision you made under an assumption, where the other branch is worth a human's look
- work you started and deliberately stopped (say what is half-done and where)

Do not file: a bug in your own change (fix it), a failing or flaky test (fix it — AGENTS.md hard
rules), a note already covered by an existing roadmap/story-backlog/human-decision entry (link to
it in the PR instead), or a vague "we could improve this someday" with no concrete first step.

### How

`gh issue create --title "..." --label needs-triage --body "..."`, with the title stating what
should happen (not just naming an area) and the body shaped like this:

```
**Kind:** question | improvement | risk | cleanup | half-done
**Effort:** S | M | L
**Touches:** `src/lib/example.ts`, `docs/product/example.md`

## What I noticed

The observation, concretely, with file paths and the behaviour a person would see. Written for a
reader who was not in the session and has no memory of the change that raised this. Name the case
that goes wrong, not the abstraction.

## Why it isn't already done

The honest reason: outside the scope I was given / needs a policy call I can't make / needs a
schema change that deserves its own review / I disagreed with the obvious approach and want a
second opinion. If it is a question, this is where the options and their trade-offs go, with a
recommendation.

## Proposed change

What to actually do, at the level of "which file, what shape". State what you are *not* proposing
if there is an obvious wrong turn nearby. If it is a question, state what you would do under each
answer.

## Prompt

​```text
A self-contained instruction that can be pasted into a fresh session with zero context. It names
the files to read first, states the constraint that makes this non-obvious, defines done, and
names the checks to run (pnpm check, a focused test, e2e when a flow changed). Ends by telling the
session to close this issue when the work lands — not a file path, since the issue is where the
reader already is.
​```
```

An issue blocked on somebody *outside this repo* — an upstream release, a third party's answer, a
measurement that needs traffic the site has not had — also carries `waiting-on-external`, plus a
`**Waiting on:**` line naming the event *and how a reader would check whether it has happened*.
Without that second half it is indistinguishable from an issue nobody got round to, which is the
state the label exists to prevent. `gh issue create --label needs-triage,waiting-on-external ...`.

**The prompt is the point.** Every entry ends with a fenced prompt block that Aaron can paste into
a fresh session, with no memory of your session, and get the work done. That means it names the
files, states the constraint that makes the task non-obvious, says what "done" looks like, and
names the checks to run. A prompt that says "improve the manifest page" is not an entry; it is a
sticky note. `pnpm check:follow-ups` refuses the obvious failures (no prompt, no file paths in it,
no instruction to close the issue) but it cannot tell you the prompt is *good* — write it as if you
will be the one who has to execute it cold.

**One item per issue.** If you noticed three unrelated things, that is three issues. An entry that
needs the reader to hold two unrelated proposals in their head gets triaged as neither.

### For the human: triage

An issue has exactly two ends, and neither is "leave it open, marked done":

- **Accept** — either relabel it (`ready-for-agent`/`ready-for-human`, see
  [triage-labels.md](triage-labels.md)) and let it run as an ordinary tracked issue, or move the
  decision into [features/roadmap.md](../product/features/README.md),
  [human-decisions.md](../product/human-decisions.md), or an ADR, and close the issue with a
  comment pointing at where it landed. Or just run the prompt: when the work lands, close the issue
  in that PR.
- **Decline** — close it as not planned. If it is worth remembering that it was declined and why,
  say so in the ADR or roadmap entry the decision touches; a tracker full of closed-with-no-reason
  issues helps nobody.

`parked` is the one in-between: you have read it, it is real, and it is not now. Add a `**Parked:**`
comment saying what would un-park it, so the next reader does not re-triage it from scratch.

### Rules

- **One issue per item**, labelled `needs-triage`.
- **Every section filled**, including a runnable prompt that names real paths and tells the session
  to close the issue.
- **Close by closing the issue**, never by commenting "done" and leaving it open.
- **An issue blocked on somebody outside this repo carries `waiting-on-external`**, with a
  `**Waiting on:**` line naming the event and how to check it. Not "blocked on Aaron" — that is
  what a plain `needs-triage` issue already is.
- **Never file instead of doing the work you were asked to do.** This is for what is genuinely
  outside the scope you were given, not a place to defer the task.
- **Never act on an entry as a drive-by.** If you want to do one, that is its own change with its
  own PR — and closing the issue is part of it.
- `pnpm check:follow-ups` (inside `pnpm check:repo` → `pnpm check`) enforces the mechanical parts
  and prints how many issues are open and how many are waiting on somebody else. It fails open when
  `gh` can't reach GitHub — a network hiccup is not a content problem.
- `pnpm gates` ages every open `needs-triage` issue — id, status, kind, effort, and days since
  GitHub's own `createdAt`, oldest first — beside the human-decision gates it reports on. Age is
  deliberately reported there and nowhere else: an issue waiting on your judgment is not a build
  failure, so no check fails on a stale one, and nothing that report lists is an agent's to close.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
