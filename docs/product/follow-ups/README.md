# Follow-ups — the agent inbox

Where an agent leaves the things it thought of but did not do: the idea the change suggested, the
question only a human can answer, the risk it found in passing, the cleanup it deliberately left
out of scope. One file per item, so parallel sessions never collide on the same file.

Before this folder existed those thoughts lived in a session's closing message or a PR comment —
read once, then gone. This is the permanent place. Aaron triages it; agents file into it and never
grade their own homework by silently doing the work instead.

**Two rooms.** This folder is the inbox: every entry in it is waiting on Aaron's judgment, so
reading one costs him a decision. [`waiting/`](waiting/README.md) is for the entries where nobody
here can move — an upstream release, a third party's answer, a measurement that needs traffic we do
not have yet — because three entries that cannot move for six months, sitting among the ones that
can, teach a reader that most of the folder is noise. Those carry `**Status:** Waiting` and a
`**Waiting on:**` line naming the event *and how to check it*; see that folder's README before
moving anything into it. An entry blocked on a call **Aaron** owns is not waiting, it is triage:
it stays here as `Parked`.

## For agents: file a follow-up

**When.** You are finishing a change and you have any of these:

- an improvement you can see but that is outside the scope you were given
- a question whose answer would change what you built (policy, pricing, tone, dive-safety practice)
- a risk, latent bug, or piece of debt you noticed while reading nearby code
- a decision you made under an assumption, where the other branch is worth a human's look
- work you started and deliberately stopped (say what is half-done and where)

Do not file: a bug in your own change (fix it), a failing or flaky test (fix it — AGENTS.md hard
rules), a note already covered by an existing roadmap/story-backlog/human-decision entry (link to
it in the PR instead), or a vague "we could improve this someday" with no concrete first step.

**How.** Copy [TEMPLATE.md](TEMPLATE.md) to `FU-YYYYMMDD-short-slug.md` in this folder, using the
date you filed it and a collision-resistant slug (same id convention as ADRs — never "the next
number"). Fill every section. Commit it with the change that raised it, and list it in the PR
description so the human sees it at review time.

**The prompt is the point.** Every entry ends with a fenced prompt block that Aaron can paste into
a fresh session, with no memory of your session, and get the work done. That means it names the
files, states the constraint that makes the task non-obvious, says what "done" looks like, and
names the checks to run. A prompt that says "improve the manifest page" is not an entry; it is a
sticky note. `pnpm check:follow-ups` refuses the obvious failures (no prompt, no file paths in it,
a stub) but it cannot tell you the prompt is *good* — write it as if you will be the one who has
to execute it cold.

**One item per file.** If you noticed three unrelated things, that is three files. An entry that
needs the reader to hold two unrelated proposals in their head gets triaged as neither.

## For the human: triage

An entry has exactly two ends, and neither is "mark it done here":

- **Accept** — move it to where committed work lives ([features/roadmap.md](../features/roadmap.md),
  [features/story-backlog.md](../features/story-backlog.md),
  [human-decisions.md](../human-decisions.md) for a decision you own, an ADR for a hard-to-reverse
  choice) and delete the file. Or just run the prompt: when the work lands, delete the file in that
  PR.
- **Decline** — delete the file. If it is worth remembering that it was declined and why, say so in
  the ADR or roadmap entry the decision touches; a folder of tombstones helps nobody.

`Status: Parked` is the one in-between: you have read it, it is real, and it is not now. Add a
`**Parked:**` line saying what would un-park it, so the next reader does not re-triage it from
scratch.

There is a fourth end that is not a triage outcome at all: if the entry cannot move because someone
*outside this repo* owes the next step, `git mv` it into [`waiting/`](waiting/README.md) and give it
a `**Waiting on:**` line. That is not a decision about the idea — it is a statement that re-reading
it every week is wasted, and it keeps this folder to things you can actually act on today.

This folder is an inbox, not a backlog. It holds items awaiting your judgment — once you have
judged, the item belongs in the file that carries committed work, per
[features/README.md](../features/README.md)'s single-home rule.

## Rules

- **One file per item**, named `FU-YYYYMMDD-short-slug.md`, id matching the `#` heading.
- **Every section filled**, including a runnable prompt that names real paths.
- **Close by deleting**, never by writing "done" — same rule as the roadmap and the assessments.
- **An entry blocked on somebody outside this repo lives in [`waiting/`](waiting/README.md)**, with
  a `**Waiting on:**` line naming the event and how to check it. Not "blocked on Aaron" — that is
  what this folder already is.
- **Never file instead of doing the work you were asked to do.** This folder is for what is
  genuinely outside the scope you were given, not a place to defer the task.
- **Never act on an entry as a drive-by.** If you want to do one, that is its own change with its
  own PR — and deleting the entry is part of it.
- `pnpm check:follow-ups` (inside `pnpm check:repo` → `pnpm check`) enforces the mechanical parts
  and prints how many entries are open and how old the oldest is.
- `pnpm gates` ages the whole register — id, status, kind, effort, and days since the date in the
  id, oldest first — beside the human-decision gates it reports on. Age is deliberately reported
  there and nowhere else: an entry waiting on your judgment is not a build failure, so no check
  fails on a stale one, and nothing that report lists is an agent's to close.
