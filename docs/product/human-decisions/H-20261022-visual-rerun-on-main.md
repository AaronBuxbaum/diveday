# H-20261022-visual-rerun-on-main: May a failed visual capture rerun on main?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**One flaky capture on main publishes no screenshot baseline, so every branch cut from that commit
compares nothing.** Four of the six red main runs on 2026-10-22..23 were one visual shard failing,
each on a different spec, and each cost a human "Re-run failed jobs". Rerunning on main loosens the
rule that the suite runs `retries: 0` so every flake is root-caused. The 2026-10-23 code sheet
(item 7, call 4) asked whether to allow it.

## Decision

**Decided 2026-10-23 (Aaron, in the project thread: "Yes").** On main only, a failed visual shard
reruns its failed captures once, whatever the cause, and a capture that passes only on the rerun
is filed as a `needs-triage` issue naming its spec. Pull requests keep zero retries.

## What ships

`.github/workflows/ci.yml`'s visual capture step and its `visual-flakes` job, with
`scripts/visual-flake-issue.mjs`. [testing.md](../../engineering/testing.md) states the rule.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
