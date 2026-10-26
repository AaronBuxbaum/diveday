# 20261026-project-local-node-runtime — Pin the fixed Node runtime locally and in CI

- **Status:** Accepted
- **Date:** 2026-10-26
- **Supersedes:** [20260903-node-24-is-the-floor](20260903-node-24-is-the-floor.md)

## Context

[Issue #3083](https://github.com/AaronBuxbaum/diveday/issues/3083) reproduced a local dev failure
under Node 24.18.0 with valid pnpm dependencies. An unrelated pipe stat makes Node's realpath
cache preserve package symlinks, duplicating Next modules and losing their dependency lookup
paths ([upstream defect](https://github.com/nodejs/node/pull/65113)). Dependency engine ranges
admit affected versions, so the lowest dependency-compatible version is insufficient evidence of
a correct runtime. The same reproduction passes on Node 24.22.0, already pinned in CI.

## Decision

Keep Node 24 as the supported major and retain the separately declared Lambda major 24,
Node type major 24 and ES2024 library baseline. `scripts/check-node-version.mjs` remains the
source of truth for these declarations, the supported floor and the exact CI runtime.

Set `NODE_FLOOR` to 24.22.0 and `engines.node` to the closed range `^24.22.0`. Pin
`devEngines.runtime` to Node 24.22.0 with `onFail: download`, matching unchanged
`CI_NODE_VERSION`. pnpm records the exact runtime and platform checksums in its lockfile;
installation and scripts select it locally without changing global Node. `.nvmrc` continues
to select the supported major.

Reject an unsupported direct dev-server runtime before starting children or touching dev state,
with the actual version and the project-local installation command. Bootstrap and doctor report
full-version mismatches. The version guard checks the local runtime pin against CI; dependency
compatibility remains tested, alongside a fresh-process pipe-stat/symlink regression.

## Alternatives considered

- **Keep the dependency-derived floor** — advertises runtimes that reproduce the failure.
- **Use global Node changes** — affects unrelated sessions and does not travel with a checkout.
- **Hoist helpers or patch resolution** — conceals duplicate module identity and misses other
  affected packages.
- **Upgrade Next or change bundlers** — does not repair the independently reproduced Node defect.

## Consequences

A first installation may download the pinned Node runtime. Bare external Node invocations can
still bypass pnpm selection; the dev supervisor refuses unsupported versions with a repair path.
Other direct scripts remain the caller's responsibility, with bootstrap and doctor exposing drift.

Runtime minimums now reflect correctness as well as dependency compatibility; the old
lowest-dependency equality no longer applies. Revisit the pin when a supported Node release or
our dependencies require it, updating the manifest, generated runtime lock and version guard
with the regression and cold-dev checks. Changing the supported major still requires checking
Lambda availability, types and the ES baseline; switching a local pin does not silently change
those decisions.
