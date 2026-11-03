# 20261103-advisory-is-a-finding — Record an advisory as a finding at strictness zero, in one table

- **Status:** Accepted
- **Date:** 2026-11-03
- **Amends:** [20260730-site-depth-and-diver-age-surfaces](20260730-site-depth-and-diver-age-surfaces.md) — the depth advisory rides `listTripReadiness` as an entry in `advisories`, not as `depthAdvisory`; it is still a sibling of readiness and never a blocker

## Context

Six modules warn without gating: depth ceilings, dive recency, course crew ratios, the shop's
divemaster target, minimum seats and the pre-departure check. Each had its own result shape, and
"informs, never gates" was restated in prose across dozens of files (issue #2707). The owner chose
to build the unification on 2026-11-02. The constraint that must not move: **an advisory never
makes a diver `blocked`** (H-20260724-certification-levels-agency-rules; ADRs 20260820, 20260821,
20260824). A first evaluation rejected the filed shape (one list, a severity column) because 95
`.blockers` reads would each have to filter, and one miss would refuse boarding.

## Decision

`src/lib/findings.ts` holds one vocabulary. A finding is `{ code, params }`; its code is a
`ReadinessBlockerCode` or an `AdvisoryCode`, and `FINDING_STRICTNESS` gives every code one row,
`blocks` or `informs`. The guarantee is held three ways:

- **Two lists, by type.** `ReadinessResult.blockers` holds blockers only. A compile-time check fails
  if a code is in both unions, and `calculateReadiness` takes no advisory input.
- **The table is typed from the unions.** A blocker code can only be tabled `blocks` and an advisory
  only `informs`, so making an advisory gate means moving its code into `ReadinessBlockerCode` and its
  evaluator into `calculateReadiness`: an owner decision and an ADR, never a one-row edit.
- **Status reads the table and fails closed.** `calculateReadiness` returns `findingsStatus(blockers)`;
  a code the table does not know blocks.

Each finding has a subject, `booking` or `departure`. Departure findings (crew, ratio, minimum seats,
pre-departure) render on the trip's own row and never join a diver's readiness. Each module keeps
computing its own answer; one adapter per module turns that answer into a finding or null. The depth
advisory is the first carried end to end: `listTripReadiness` returns `advisories`, and the roster,
manifest, printout and offline copy read it through `depthAdvisoryIn`.

## Alternatives considered

- **One list with a severity column** (the filed shape) — trades a compile-time guarantee for a
  runtime filter at every reader of a safety-critical list.
- **Leave the six shapes** — keeps the prose and the six vocabularies the owner asked to retire.

## Consequences

A new advisory is one code, one table row, one adapter and its words. H-51 (whether the pre-departure
check gates) stays a real decision: gating it would be a departure-level result, which this table
names but does not evaluate. The other surfaces still render recency, crew, ratio, seats and the
checklist from their modules' own shapes; moving each to its finding is mechanical and can follow
when its surface next changes.
