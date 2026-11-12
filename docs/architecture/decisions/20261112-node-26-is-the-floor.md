# 20261112-node-26-is-the-floor — DiveDay runs on Node 26; Lambda stays on 24 until it is generally available

- **Status:** Accepted
- **Date:** 2026-11-12
- **Supersedes:** 20260903-node-24-is-the-floor

## Context

Node 26 is the current LTS line (26.13.1 as of 2026-11-10) and Vercel runs it generally available. Nothing here pins us to 24, and `jsdom@30` already accepts `>=26.0.0`.

## Decision

**DiveDay develops, tests and builds on Node 26.** The three numbers still live in `scripts/check-node-version.mjs`, which still refuses any file that drifts:

- `NODE_MAJOR = 26`, `NODE_FLOOR = "26.0.0"` (the lowest release every installed dependency accepts), so `engines.node` is `^26.0.0`.
- `CI_NODE_VERSION = "26.13.1"`, the exact CI pin.
- `LAMBDA_NODE_MAJOR = 24`. AWS offers Node 26 on Lambda only as a public preview and `aws-cdk-lib` 2.276 has no `NODEJS_26_X`, so the Lambdas and their esbuild target stay on `nodejs24.x`. Raise it once Lambda's runtime is generally available and CDK names it.

The mechanics, the reasons for a closed `^` range and for deriving the floor from the installed graph, are unchanged from the superseded decision.

## Alternatives considered

- **Stay on Node 24.** Rejected: nothing needs it, and Node 24 leaves active LTS first.
- **Move the Lambdas to the Node 26 preview.** Rejected for now: a preview runtime has no production support and CDK cannot name it.

## Consequences

- One exact pin (`26.13.1`) in CI; bump it with `CI_NODE_VERSION` and the guard names every file to change.
- `@types/node` is `^26.6.6`, so the tree type-checks against the major it runs on.
- Lambda and local Node differ by two majors until AWS ships Node 26 generally; `LAMBDA_NODE_MAJOR` is the one number to raise.
