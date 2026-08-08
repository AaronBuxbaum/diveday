# FU-20260808-gates-reports-follow-up-ages — Report follow-up ages in `pnpm gates`

- **Status:** Open
- **Raised:** 2026-08-08 — the change that created this register (branch `claude/agent-followups-tracking-1aop6n`)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `scripts/gate-freshness.mjs`, `scripts/gate-freshness.test.mjs`, `docs/product/follow-ups`

## What I noticed

`pnpm gates` already answers "what is waiting on a human, and for how long" for the H-/V- rows in
`docs/product/human-decisions.md`, deriving ages from dated outcomes and `git blame`. The follow-up
register is the same shape of thing — items parked on a human's judgment that rot silently — but it
has no aging report at all. `pnpm check:follow-ups` prints a count and the oldest date because a
gate is the wrong tool for aging (an old entry is not a build failure), which leaves the count as
the only signal that eleven entries have been sitting there since June.

## Why it isn't already done

Out of the scope I was given, which was the register itself. It also needs a judgment I would rather
a human make: whether a follow-up's age should sit in the same report as the launch gates — where it
competes for attention with decisions that genuinely block launch — or whether stale follow-ups
deserve their own quieter surface. Folding them in is a one-file change; splitting them is a new
script and a new habit.

## Proposed change

Add a follow-up section to `scripts/gate-freshness.mjs`: read `docs/product/follow-ups/FU-*.md`,
take each entry's age from the date in its filename (no `git blame` needed — the id carries the
date), and print id, kind, effort, and age, sorted oldest first. Keep it a report, never a gate:
`pnpm gates` is deliberately outside `pnpm check` and must stay that way. Extend
`scripts/gate-freshness.test.mjs` alongside. Do not add a staleness threshold that fails anything.

## Prompt

```text
In the diveday repo, extend `pnpm gates` (scripts/gate-freshness.mjs) so it also reports the
agent follow-up register alongside the human-decision gates.

Read first: scripts/gate-freshness.mjs, scripts/gate-freshness.test.mjs,
docs/product/follow-ups/README.md, and scripts/check-follow-ups.mjs (which already parses these
entries — reuse its exported parsing rather than writing a second parser if that is clean).

What to build: a section listing every docs/product/follow-ups/FU-*.md entry with its id, Kind,
Effort, and age in days, oldest first, plus the total count. Take the age from the YYYYMMDD in the
filename, not git blame — the id carries the date and a shallow clone cannot bound it.

Constraints that make this non-obvious: `pnpm gates` is a report and never a gate — it must not
exit non-zero on stale entries, and it must not be added to `pnpm check` or scripts/check-repo.mjs.
Nothing it reports is an agent's to close. Follow the existing output shape in gate-freshness.mjs
rather than inventing a second format.

Done when: `pnpm gates` prints the follow-up section against the real register, a new case in
scripts/gate-freshness.test.mjs covers the age math and the empty-register case, `pnpm check` is
green, and docs/product/follow-ups/README.md plus the AGENTS.md `pnpm gates` row mention that the
report covers follow-ups too. Delete docs/product/follow-ups/FU-20260808-gates-reports-follow-up-ages.md
as part of the change.
```
