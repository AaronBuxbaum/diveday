# H-20261105-ci-on-the-stack-top: Which layers of a stack run CI?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Which layers of a stack run CI?** H-20261003-every-layer-stack-run made every layer run the whole gate.

## Minimum outcome to record

Whether lower layers keep running CI.

## Outcome

**Decided 2026-11-05 (Aaron Buxbaum, in session):** "we only have a certain number of agents at a given time on our GitHub account ... CI running on the top of the stack is most valuable since I often merge the entire stack ... we also definitely want to avoid running CI on a "slice" of a PR stack." Recorded as ADR [20261105-ci-runs-on-the-top-of-the-stack](../../architecture/decisions/20261105-ci-runs-on-the-top-of-the-stack.md).

## Unblocks / follow-up

Supersedes H-20261003-every-layer-stack-run. A red top is fixed from the top.

Part of the [human decision log](README.md#decision-register).
