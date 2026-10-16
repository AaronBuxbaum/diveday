# The daily triage routine

The `needs-triage` inbox is read every morning by a scheduled Claude Code routine, not by whoever
next has a spare hour. On 2026-10-12 one day's builds filed 128 follow-ups and none was triaged:
39,574 words of bodies, about 53k tokens of reading before the first decision. Aaron asked for this
routine on 2026-10-03 ("triages all tickets in ready-for-triage, with the /triage skill"), and a
session created it that day as the routine "diveday: Daily triage" (`trig_01PFtibgCUma8V28Hp7qqViC`,
`54 12 * * *`). It last fired on 2026-10-06: it woke one persistent session every day, that session
was steered into code work (it merged #2126), sat at 302,736 of 500,000 context tokens and
disconnected, and its prompt said `gh` was missing and checked out `origin/main` inside the shared
checkout. Until 2026-10-13 nothing in the tree defined it; this file does now.

## Where it lives

A routine lives in Claude Code (a scheduled trigger), not in the repository: nothing in the tree can
start one. This file is its definition, and the trigger is `trig_01PFtibgCUma8V28Hp7qqViC`. A
session that carries the `update_trigger` tool sets it from this file (a human can paste the same
fields into Claude Code's routines). When the prompt changes here, update the trigger in the same
change, and fire it once to check it.

- **Schedule:** daily, 06:30 UTC (`30 6 * * *`). That is after `.github/workflows/follow-ups.yml`
  (06:00), so the routine reads a tracker whose malformed issues are already named and whose dead
  claims are already expired.
- **Repository and branch:** `AaronBuxbaum/diveday`, `main`.
- **Budget:** at most 25 issues per run, oldest first. A run that reads all 128 at once spends its
  context on reading and decides badly at the end.
- **A fresh session every run:** `persist_session: false`. A routine that wakes one long-lived
  session starts each run with the last run's context and invites being steered into other work,
  which is how this one stopped firing. The same holds for the weekly ready-for-human digest
  (`trig_01DBL9P5ybwGoUXkoYiqJNNk`) and the weekly token check (`trig_013qYw7hrgYF64tQ2MYakWBd`).

## What holds the inbox down between runs

- `node scripts/check-follow-ups.mjs` (the 06:00 job) fails while more than 40 issues are open under
  `needs-triage` (`INBOX_CEILING`), and `scripts/file-follow-up.mjs` refuses a new one then unless
  `--over-quota "<why>"` says why it cannot wait.
- The filing quota is one per clone, not per checkout: ten in twelve hours across every worktree, so
  a stack is counted once ([issue-tracker.md](issue-tracker.md)'s "Rules").
- A `**Kind:** question` files straight to `ready-for-human`, and the 06:00 job moves any that
  reached the inbox another way (`node scripts/check-follow-ups.mjs --apply-routing`; it moved 31 on
  2026-10-13), so questions do not reach this routine. A title whose words overlap an open issue's
  by 80 percent or more is filed with a warning naming the twin: folding it is this routine's call.

## The prompt

The `triage` skill is `disable-model-invocation: true`, so the prompt has to name it with its slash
command; a routine that says "triage the inbox" in words never loads it. Paste this as one block:

```text
/triage Work the needs-triage inbox unattended. You are acting for the maintainer, so apply your recommendation instead of waiting for direction, and post every comment with the triage skill's AI disclaimer. Reach GitHub through `gh api` (REST) or the GitHub MCP tools; `gh issue` and `gh pr` (GraphQL) are refused in this container. Never check out, reset or edit anything in /home/claude/diveday or any wt-* worktree: read code on main with `git fetch origin main` and `git show origin/main:<path>`. Read docs/agents/triage-routine.md, docs/agents/triage-labels.md and docs/agents/issue-tracker.md's "For the human: triage" section first. List open issues labelled needs-triage, oldest first, and take at most 25. For each one: read the body and comments; check the code it names on main; then do exactly one of these. (1) Already done or no longer true: close it as completed or not planned with one sentence saying where it landed or why it no longer applies. (2) A near-duplicate of another open issue: fold it into the older one with a comment that carries anything new, and close it as a duplicate. (3) Fully specified and safe for an agent: run `node scripts/check-follow-ups.mjs --body <file> --title "<title>"` on its body, fix any missing Touches path, then relabel it ready-for-agent and post an agent brief. (4) Needs a human's judgment (a policy, pricing, tone or dive-safety call, external access, a design decision, or Kind: question): relabel it ready-for-human with a brief saying what has to be decided and what each answer would change. (5) Real but not now: add the parked label with a **Parked:** comment saying what would un-park it. Never leave an issue with both needs-triage and a state label. Do not file new follow-up issues and do not change code. End with a short report: how many you closed, folded, moved to ready-for-agent, moved to ready-for-human and parked, the issue numbers in each group, and how many remain under needs-triage.
```
