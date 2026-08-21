# 20260821-follow-ups-are-github-issues — File agent follow-ups as GitHub issues, not a file-based register

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

[20260808-agent-follow-up-register](20260808-agent-follow-up-register.md) put the agent inbox in
`docs/product/follow-ups/` — one Markdown file per idea, question, risk, or deliberately-skipped
cleanup, checked by `scripts/check-follow-ups.mjs` and aged by `pnpm gates`. It explicitly
considered and rejected GitHub issues at the time: "the canonical process here is the repo itself
(AGENTS.md, `docs/`, scripts, tests); an agent reading a fresh clone cannot see issues."

That premise no longer holds. This repo now runs specs and bugs through GitHub issues
(`docs/agents/issue-tracker.md`, adopted from the mattpocock/skills agent-workflow pattern), with a
canonical triage-label vocabulary (`docs/agents/triage-labels.md`: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`) already wired into `gh issue` conventions an agent
uses on every session. Running the follow-up inbox as a second, repo-local system next to that
tracker means Aaron triages from two places, and an accepted follow-up that becomes real work still
has to be re-created as an issue to enter the same execution pipeline a spec-derived ticket already
uses. The file register's original problem — a single append-to-me file becomes a merge-conflict
magnet across the parallel sessions this repo assumes — is exactly what an issue tracker with
per-item ids was built to solve; the file-based register was working around not having one yet.

Auditing the fix surfaced a second, unrelated gap: `docs/agents/triage-labels.md` documented
`needs-triage`, `needs-info`, `ready-for-agent`, and `ready-for-human` as real repo labels, but only
GitHub's own default `wontfix` had ever actually been created. The Matt Pocock skill setup wrote the
docs without provisioning the labels they describe. Fixed in the same change (see Decision).

## Decision

A follow-up is a GitHub issue labelled `needs-triage`, with a body carrying `**Kind:**`,
`**Effort:**`, `**Touches:**` metadata and four sections (*What I noticed*, *Why it isn't already
done*, *Proposed change*, *Prompt*) — the same shape the file register used, minus `Status` and
`Raised` (an issue's open/closed state and GitHub's own `createdAt` already carry those). The prompt
ends by telling the session to close the issue when the work lands, rather than naming a file to
delete. Full filing instructions live in `docs/agents/issue-tracker.md`'s "Filing a follow-up"
section (the old `docs/product/follow-ups/README.md` and `TEMPLATE.md` are deleted, not preserved
as a second copy).

Two additional labels, created alongside `needs-triage`/`needs-info`/`ready-for-agent`/
`ready-for-human` (closing the gap above): `waiting-on-external`, for an issue blocked on something
outside this repo (an upstream release, a third party's answer, traffic the site does not have
yet), which must carry a `**Waiting on:**` line naming the event *and how to check it* — the exact
rule the old `follow-ups/waiting/` room enforced, now a label instead of a folder. And `parked`, for
an issue a human has read and deliberately deferred, carrying a `**Parked:**` line saying what would
un-park it.

`scripts/check-follow-ups.mjs` (in `pnpm check:repo` → `pnpm check`) still enforces the mechanical
half — the metadata vocabulary, `Touches:` paths that exist on disk, real prose in each section, a
prompt long enough that names a repo path and says it closes the issue — now read via
`gh issue list --label needs-triage --state open --json ...` instead of the filesystem. This is the
one check in `pnpm check:repo` that makes a network call; every other check there is a static,
offline pass over the repo by design (see `check-repo.mjs`'s header comment), and `pnpm check`
sitting in the commit gate cannot tolerate the network-flake tolerance this repo already refuses
everywhere else (`pnpm check:e2e-hygiene`'s ban on timing-based retries makes the same argument
about a different kind of flake). So the check **fails open**: if `gh` cannot answer — offline,
unauthenticated, GitHub down — it prints a warning and exits 0 rather than blocking a commit on
network state. It still fails hard on real content problems once `gh` does answer. CI's
`repo-safeguards` job gets an `issues: read` permission and `GITHUB_TOKEN` so the check runs for
real there rather than degrading on every PR. `pnpm gates` ages open `needs-triage` issues the same
way it aged the file register, from `createdAt` instead of the `FU-YYYYMMDD-` id.

The 12 open and 2 `waiting/` entries that lived in the register at the time of this decision were
migrated to issues #609–#622 in the same change, by a script that parsed each file's metadata and sections
into an issue body and rewrote the self-referential "delete this file" sentence into a "close this
issue" one. The files were then deleted. A consequence of the migration, not a bug: each migrated
issue's `createdAt` is the migration date, not the file's original `Raised` date, so
`pnpm gates`' ages reset to zero for all fourteen — the original raised date survives only as a
`**Originally raised:**` note in each issue's body, not as the sortable age. A fifteenth entry
(#629) arrived the same way during this change's own PR: a concurrent PR merged into `main` mid-review
and re-created the just-deleted `docs/product/follow-ups/` directory with one new file, filed the old
way before that PR's author could see this decision land. It was migrated by the same script rather
than merged in as a file, to keep the tree in the state this ADR describes rather than resurrecting
the register for one entry.

## Alternatives considered

- **Keep both systems** — route only new bugs found during a run to GitHub Issues and leave the
  file register for everything else. Rejected: it recreates the exact "which of two places do I
  file this" split the file register was supposed to resolve as the *single* agent inbox, and gives
  Aaron two triage queues instead of one.
- **A dedicated `follow-up` label instead of reusing `needs-triage`** — would make a follow-up
  visually distinct from a spec-derived issue in the tracker. Rejected: `needs-triage`'s canonical
  meaning ("maintainer needs to evaluate this issue") already describes exactly what a freshly
  filed follow-up is, and an issue that gets accepted should become an ordinary tracked issue
  without a label swap masking that it always was one.
- **Keep the check offline by skipping content validation entirely, report-only like `pnpm gates`**
  — simpler, no network dependency in `pnpm check`. Rejected: the file register's whole value was
  refusing an under-written entry before it landed (see 20260808's Context), and that value is worth
  the fail-open network exception more than it is worth losing.
- **Backdate migrated issues' `createdAt`** — the GitHub API does not support setting `createdAt` on
  creation, so this was not actually available; noted here so a future reader does not propose it
  as an easy fix without checking.

## Consequences

One triage surface instead of two; an accepted follow-up enters the same `ready-for-agent`/
`ready-for-human` pipeline a spec-derived issue already uses, with no re-creation step. Costs the
one network dependency in an otherwise fully offline `pnpm check:repo`, mitigated by failing open.
Costs the migrated issues their original age (see Decision) — acceptable once, not a pattern to
repeat: a future format change to the *live* tracker should edit issues in place via `gh issue edit`
rather than close-and-recreate, so `createdAt` survives.

Revisit if `pnpm check:follow-ups` degrading silently in a disconnected environment (no `gh` auth
configured) turns out to matter more than avoided flakiness — the fix there is a louder warning or
a separate report, not reverting to a file-based register. Revisit the two new labels if `parked`
or `waiting-on-external` turn out to need their own aging or triage semantics beyond what
`pnpm gates` already gives every other label.
