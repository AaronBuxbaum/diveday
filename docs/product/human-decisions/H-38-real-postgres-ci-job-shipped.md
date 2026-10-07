# H-38: The real-Postgres CI job shipped 2026-08-06 on a nightly-plus-src/db/-path-gated cadence rather than per-PR, an…

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

The real-Postgres CI job shipped 2026-08-06 on a nightly-plus-`src/db/**`-path-gated cadence rather than per-PR, an engineering default rather than an explicit owner sign-off (`comprehensive-review-20260802` HD-19). See [20260806-real-postgres-ci-job](../../architecture/decisions/20260806-real-postgres-ci-job.md).

## Minimum outcome to record

Confirm the shipped cadence, or ask for per-PR (higher runner-minute spend) or a different schedule.

## Unblocks / follow-up

Narrower than the original "nightly, per-PR, or not at all" ask — the mechanism already exists either way.

Part of the [human decision log](README.md#decision-register).
