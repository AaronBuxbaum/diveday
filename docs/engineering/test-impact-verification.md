# Test-impact verification

The goal is fast, honest feedback while an agent edits, not permission to skip full CI.
Unit, functional-browser and visual selection keep their different models. A shared command
composes the first two; forcing HTTP and database dependencies into a JavaScript import graph
would lose information rather than improve recall.

## Local command

Run `pnpm verify:agent --plan`, then `pnpm verify:agent`. An explicit base can be supplied with
`--base <ref>`. Staged, unstaged and untracked inputs are included. Locale values come from the
working tree rather than HEAD. Missing diff evidence refuses verification, never selects nothing.

The command runs lint, typecheck, repository safeguards, guard tests and existing unit selection.
Units retain source-reader contracts, conservatively seed computed-import owners that native
related selection misses, and keep full fallbacks for global, unknown or deleted inputs.
Browser selection retains route, symbol, locale, fixture and removed-text evidence. All strong
matches and five mandatory smoke flows run; the highest-ranked additional reach gets ten minutes
of recorded CI duration, adjustable with `--browser-minutes <number>`. This is an estimate for
reach only, not a wall-clock ceiling: build time, smoke and strong matches are additional.

Database/schema/seed, HTTP API, shared auth, browser harness and build configuration changes
cannot be bounded reliably by imports alone. They conservatively select all functional browser
specs, as do unknown/deleted inputs and runtime changes with no mapped coverage. This overrides
the reach budget. It intentionally trades speed for confidence until shadow evidence supports
narrower explicit contracts. Visual and mobile tests remain separate and are named as unrun.

The receipt is in the worktree's git metadata, not a committed file. It fingerprints tracked and
untracked source bytes, detects edits during the run, records each step and explicitly lists
deferred reach. It is not a clean-HEAD push stamp. A missing browser, failed build or missing smoke
test fails rather than quietly downgrading to unit-only verification. Generated/ignored files and
external services are not a hermetic environment; full CI remains authoritative.

## Shadow measurement

Every full functional CI shard records selection before tests run and compares it with actual
first-attempt and containment-retry reports afterward. JSON artifacts live beside existing
browser-duration artifacts. Strong-only, full affected and agent-budget selections are compared
separately. Reports include selected/deferred failure candidates, retry-recovered flakes,
repeated failures, observed attempt durations and fallback reasons. No test is omitted from CI.

A deferred failure is a candidate selection miss, not proof that the diff caused it. Confirm it
with reproduction and a base comparison before changing the model. Retry recovery is evidence
of instability, not evidence that a test is irrelevant. Duration sums are test-attempt cost,
not parallel job wall time. Missing reports and mismatched SHA evidence cannot report a clean
measurement. Unit and visual shadow coverage are not yet measured by this functional report.

Historical evaluation must run the selector and test discovery in the historical checkout.
`e2e:affected --commit` only chooses a diff; it does not time-travel the current source graph.
Do not report that convenience mode as historical recall.

## Incremental mode

The [Vitest 5.1 evaluation](test-incremental-evaluation.md) includes a repeatable isolated probe
and two complete runs. Incremental mode catches computed dynamic imports that native related
selection misses, but misses raw filesystem data, environment changes and preserved-mtime edits
that full runs confirm are failing. Related selection catches the preserved-mtime edit. Neither
model dominates. Keep the conservative selector, rather than replacing verification with raw
`--since-last-run`. The measured subsecond warm timings are synthetic, not application speedups.

Runtime-loaded dependency observations are useful additional evidence, but only as a union with
static selection and contracts, with environment-aware invalidation and cold-cache fallbacks.
No incremental cache is currently trusted to remove tests from the agent verification command.
