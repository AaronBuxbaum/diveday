# H-92: Does every layer of a stack run CI?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Does every layer of a stack run CI?** Since ADR 20260919-stack-ci-cancels-superseded-layers a stack's middle layers ran nothing and had in-flight runs cancelled when a layer opened above them, so a middle layer's green meant "nothing ran".

## Minimum outcome to record

Whether to keep the skip.

## Outcome

**Decided 2026-10-03 (Aaron Buxbaum, in session):** "When we build work, we should develop using GitHub Stacks instead of independent PRs. Let's also remove the handling we added in the past to skip CI for "middle" PRs of a stack and just have it always run." Recorded as ADR [20261003-every-stack-layer-runs-ci](../../architecture/decisions/20261003-every-stack-layer-runs-ci.md).

## Unblocks / follow-up

Stacks stay the default shape; every layer runs the whole gate.

Part of the [human decision log](README.md#decision-register).
