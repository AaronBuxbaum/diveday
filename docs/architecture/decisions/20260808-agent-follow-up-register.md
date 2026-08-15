# 20260808-agent-follow-up-register — Keep agent follow-ups as one file per item in a checked register

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

Every agent session ends with more thoughts than commits: an improvement outside the scope it was
given, a question whose answer would have changed the build, a risk spotted in nearby code, a
cleanup deliberately skipped. Until now those landed in the session's closing message or a PR
comment — read once during review, then unreachable. The docs already have homes for *committed*
work (`docs/product/features/` for scope, `docs/product/human-decisions.md` for human-owned calls,
ADRs for hard-to-reverse choices), but nothing for the pre-triage state: a thought a human has not
yet accepted or declined. Filing straight into the roadmap would break that folder's rule that it
holds sequenced work rather than an inbox.

Two constraints shape the format. Many short-lived sessions run in parallel, so a single
append-to-me file becomes the repo's next conflict magnet (the same failure `src/db/seed.ts` hit,
ADR 20260803-seed-scenario-modules). And the reader is the human, cold, weeks later — an entry that
requires re-deriving the finding before it can be judged gets skipped, and the register rots into a
graveyard.

## Decision

`docs/product/follow-ups/` holds one Markdown file per follow-up, named `FU-YYYYMMDD-short-slug.md`
using the same collision-resistant dated id as ADRs. Each entry carries `Status` (`Open` or
`Parked`), `Raised`, `Kind`, `Effort`, and `Touches` metadata, four sections (*What I noticed*,
*Why it isn't already done*, *Proposed change*, *Prompt*), and ends with a fenced prompt written to
be pasted into a fresh session with none of the filing session's context. The prompt names the files
to read, the constraint that makes the task non-obvious, what done looks like, and the deletion of
its own entry file.

`scripts/check-follow-ups.mjs` (in `pnpm check:repo` → `pnpm check`) enforces the mechanical half:
id/heading/date agreement, the metadata vocabulary, `Touches` paths that exist on disk, real prose
in each section, and a prompt that is long enough, names a repo path, and closes out its own entry.
It reports the count and oldest entry but never fails on volume or age — an inbox may be full, and
aging is the human's business.

The register is an inbox, not a backlog: an entry ends by being accepted (moved into
`docs/product/features/`, `human-decisions.md`, or an ADR, and the file deleted) or declined (the
file deleted). There is no "done" status, matching the roadmap and assessment rule that delivered
work leaves the planning doc rather than sitting there marked complete. Agents file; they do not
act on entries as drive-bys.

### Amended 2026-08-15 — a `waiting/` room for entries nobody here can move

Three of the register's twenty-one entries were blocked on something outside the repository: an
`aws-rum-web` release, a reply from `vercel/analytics`, and funnel numbers that need traffic the
site has not had yet. Each was `Open`, so each asked the reader for a triage decision it could not
receive — re-read weekly, deferred weekly, and (this is the cost) sitting between the entries that
*could* move, teaching the reader that most of the folder is noise.

`docs/product/follow-ups/waiting/` holds those. An entry there says `**Status:** Waiting` and
carries a `**Waiting on:**` line naming the blocking event **and how a reader would check whether it
has happened** — a changelog, an issue thread, a dashboard and the runbook for it. That second half
is the load-bearing one: without it a waiting entry is indistinguishable from an entry nobody got
round to, which is the state this split exists to end. `pnpm check:follow-ups` enforces both, checks
each room's status vocabulary against the other's, and counts them separately.

The boundary is *who owes the next move*, not how hard the work is. Blocked on Aaron is not waiting
— that is what the inbox already is, and a call he has read and deferred stays upstairs as `Parked`.
`pnpm gates` ages both rooms, deliberately: "waiting on upstream" is an honest answer only while
somebody is still checking, and an age is the only thing that says otherwise.

## Alternatives considered

- **One `follow-ups.md` everyone appends to** — simplest to read, but guarantees merge conflicts
  across the parallel sessions this repo assumes, which is exactly why seed scenarios were split.
- **GitHub issues** — the natural home in a human team, but the canonical process here is the repo
  itself (AGENTS.md, `docs/`, scripts, tests); an agent reading a fresh clone cannot see issues, and
  the prompt-carrying entry is most useful next to the code it describes.
- **File straight into `docs/product/features/roadmap.md` or `story-backlog.md`** — collapses the
  triage step: an agent's unreviewed idea would arrive indistinguishable from sequenced, accepted
  scope.
- **PR-comment convention plus a bot** — needs infrastructure, and still loses the thought when the
  PR closes.
- **No checker, format by convention** — the failure mode this exists to prevent is precisely the
  under-written entry ("revisit the pager here"), and conventions with no gate decay silently.
- **A `Status: Waiting` value instead of a folder** (2026-08-15 amendment) — one less directory, but
  it leaves the blocked entries interleaved with the actionable ones in every listing, which is the
  whole cost being paid. A reader scanning a folder sees files, not statuses.

## Consequences

Makes it cheap for a session to leave a high-quality, runnable task behind, and gives the human one
place to triage from. Costs every entry real writing effort — the check refuses a shrug — which is
deliberate: an entry not worth writing properly is not worth the human's attention.

Commits us to keeping the register empty-ish through triage. A folder with fifty stale entries is
the failure mode; `pnpm check:follow-ups` prints the count and oldest date so drift is visible, and
the follow-up filed alongside this decision proposes surfacing ages in `pnpm gates` too. Revisit if
the register stops being triaged (the entries are then just a slower graveyard, and the honest fix
is to stop filing) or if the repo moves its planning surface out of the tree, in which case the
migration is a mechanical export of one folder.
