# Next steps: agent-development enablement

The still-open engineering-enablement backlog after the booking → waiver → cert → gear → manifest →
nitrox foundation shipped. Product milestones live in [roadmap.md](roadmap.md); human approvals and
provisional defaults live in [human-decisions.md](human-decisions.md). This file holds only the work
that keeps many short-lived AI agents productive and safe, plus the measures that tell us whether it
is working.

## North star

Scuba should feel calmer, faster, and more trustworthy than the software a dive shop uses today, and
the repository should make the correct implementation path easier than an expedient wrong one. Every
meaningful increment must improve at least one of:

1. **Less staff coordination work** — fewer calls, messages, duplicate entries, and manual checks.
2. **More diver confidence** — clear next actions, visible readiness, and reassuring confirmations.
3. **Safer departure** — missing requirements become obvious early and fail closed where needed.
4. **Faster agent delivery** — narrow context, deterministic tooling, and parallel work without collisions.

## Open queue

### P1 — next

1. **Provider adapters for non-Claude agents.** Keep the provider-neutral workflow — `AGENTS.md`,
   `docs/`, `scripts/`, tests, and the canonical skills under `.agents/skills/` — as the single
   source of truth, and generate or maintain thin per-provider adapters (skill indexes, config
   pointers) that never introduce unique requirements. Add a check that detects provider
   instructions drifting from the canonical rules.
2. **Path-aware CI and changed-UI evidence.** Run the smallest trustworthy check set for a change
   while preserving the full `pnpm check` gate before merge, and require screenshot artifacts (or an
   explicit no-visual-change marker) for UI changes.
3. **Realistic seeded scenarios and visual-regression coverage** for critical empty/loading/error
   and safety states.

### P2 — when parallelism or scale proves the need

1. Shard feature/entity docs and generate optional aggregates rather than maintaining a
   merge-conflict-prone central catalog.
2. Serialize migration finalization if concurrent schema PRs collide repeatedly.
3. Introduce feature-folder boundaries incrementally, applied to the next new feature first (an ADR
   is required before establishing it as the permanent layout).
4. Add a machine-readable task manifest for external orchestrators.
5. Add automated PR scope/collision warnings based on changed paths and declared ownership.

## Measures

Track a small set of measures so "delight" and "agent efficiency" stay concrete:

- median time for staff to resolve a booking blocker;
- waiver completion rate before arrival and median completion time;
- percentage of departures with all readiness checks complete before the day of the trip;
- agent time from task start to first relevant test;
- tokens/files read before first code change (sampled, not exhaustively instrumented);
- PR rework caused by missed invariants, architecture drift, or merge collisions;
- escaped defects in safety-critical flows.

Keep this file to still-open work: when an item ships, move it into [roadmap.md](roadmap.md) or an
ADR rather than letting this plan become an unbounded second backlog.
