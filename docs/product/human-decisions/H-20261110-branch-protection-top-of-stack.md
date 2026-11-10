# H-20261110-branch-protection-top-of-stack: When should branch protection require the stack result?

- **Status:** Deferred
- **Human owner:** Aaron Buxbaum

## Outcome — 2026-11-10

Leave repository branch settings unchanged for now. When protection is enabled, require only the
top-of-stack CI result, never skipped lower-layer results. A settings change needs Aaron's
action-time permission. This record grants none.

Source: [owner-account decision record on #4196](https://github.com/AaronBuxbaum/diveday/issues/4196#issuecomment-6759906171).
The current CI design remains the accepted
[top-of-stack ADR](../../architecture/decisions/20261105-ci-runs-on-the-top-of-the-stack.md).

Part of the [human decision log](README.md#decision-register).
