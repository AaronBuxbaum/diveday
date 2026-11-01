---
name: ci-triage
description: Diagnose failed CI runs.
---

# Diagnose one failure class

1. Read the CI `ci-result-<attempt>` artifact produced by `pnpm ci:evidence`; it records the run, commit, failed jobs and `specOwners`, the open PRs that already change a failing spec. Stop if one does; comment there instead. That command needs CI environment variables; do not invoke it locally without those inputs.
2. Classify the first actionable failure: environment, context, invariant, hydration/selector, fixture, pixels, stack base, stale instruction or infrastructure. Do not treat cancellation as a failing test.
3. Read the failing assertion and the smallest relevant task packet. Reproduce that command locally against the same base/head and environment. Fix the cause; do not widen timeouts or blindly update snapshots.
4. Run the focused check, then the required push gate. Record the run and correction with `pnpm task:metrics <event.json>`; inspect `pnpm task:metrics --report`. Retain unknown observations as unknown.
5. For visual failures use visual-triage and attach changed-state evidence. Resume with the durable task state rather than rereading all logs.
