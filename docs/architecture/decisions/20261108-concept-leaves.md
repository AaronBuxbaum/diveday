# 20261108-concept-leaves — Move substrate leaves by concept in importer-first waves

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

Issue #2753 requests all eligible waves as one move. A filename twin alone is insufficient:
shared UI, browser code, schema declarations and the service worker consume substrate contracts.
Moving their providers into a server-backed feature barrel would invert a boundary or send
server code to the browser. Test fixtures also distort runtime fan-in.

This extends [feature module contracts](20260730-feature-module-contracts.md) and the
[hand-written guard decision](20261012-architecture-guard-stays-hand-written.md).

## Decision

Count production source files under `src/lib` and `src/db` using resolved module imports,
including type-only edges, re-exports, dynamic imports, relative paths and directory indexes.
A file with no other production substrate importer is a feature candidate. Tests and fixtures
are consumers of behavior, not reasons to retain a runtime layer.

Move candidates in importer-first waves, group actual rules/store twins and their labels by
concept, publish explicit named exports from one index, and move tests beside their subjects.
Runtime feature-to-feature imports go through those indexes; runtime substrate-to-feature imports
remain banned. Integration tests may reach exact subjects and mocks across layers; their imports
neither anchor substrate ownership nor grant a production boundary exemption.
Keep the departure/readiness cycle and its dependencies below features. Framework entry points
count by runtime: browser instrumentation cannot import a contract that also exports App
Router-only code.

Schema declarations remain below features. Shared predicates and shapes remain primitives where
schema, shared UI, the worker or client bundles need them. Exact retained primitive paths carry
specific reasons in `scripts/substrate-primitives.json`; a newly added consumer does not grant an
automatic exemption. The leaf guard checks that each registry entry exists and explains itself.
The shared counter predicates remain in `src/lib/check-in.ts`; the check-in use case moves.

`check-architecture.mjs` holds a separate per-file `architecture-leaves` ratchet. A new unclassified
leaf fails; a falling count must be banked. The boundary ratchet stays separate, so paying down
one rule cannot hide new debt in another. Existing guards, test isolation and coverage floors
follow the moved behavior rather than its old directory name.

## Alternatives considered

- Move every zero-incoming filename mechanically: rejected; client and schema composition roots
  make valid primitives look like application leaves.
- Move only check-in: rejected by the owner's all-wave scope; it leaves the same ownership issue
  in adjacent use cases.
- Adopt a dependency framework: unnecessary; the resolved graph and fixture tests fit the
  existing hand-written guard without another runtime or compiler dependency.

## Consequences

A concept's public contract has one reviewable home. Pure/shared code remains reusable without
importing a mixed server barrel. New primitives require a small explicit ownership decision.
Revisit when a retained primitive becomes a feature use case, or a feature needs a client entry;
extract the shared contract first rather than weakening layering. Reversing a move changes paths
and indexes, with the colocated tests and guards preserving behavior.
