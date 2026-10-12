# 20261012-architecture-guard-stays-hand-written — Keep the architecture guard hand-written; do not adopt dependency-cruiser

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

`scripts/check-architecture.mjs` enforces `app → features → lib/db` (ADR
20260730-feature-module-contracts) with its own import reader. Issue #2240 asked whether
dependency-cruiser should replace it, on the grounds that the reader ignored type-only, dynamic
and side-effect imports. A dev dependency needs an ADR, and the issue ruled out keeping both
guards. The comparison was run on 2026-10-12 over `src`, `e2e` and `scripts`, using a
`.dependency-cruiser.cjs` with the same direction table, the three seams (lib → db values,
app → `drizzle-orm`, the `@/db/trips` barrel) with the same test exemptions, and the
feature-index rule.

## Decision

Keep the hand-written guard and do not add dependency-cruiser. What the comparison found:

- **The two tools agree.** With a TypeScript 5 compiler available, dependency-cruiser 18.6.0
  reported the same 15 violations in the same 10 files as the script's `architecture` ratchet,
  and found nothing the script misses. The script reads type-only, dynamic and bare side-effect
  imports, the gaps the issue was filed about, because the seams work added that support after
  the issue was opened.
- **It cannot read this repo's TypeScript.** The project compiles with TypeScript 7, which ships
  no JavaScript compiler API. dependency-cruiser supports `typescript >=2 <7`. Without a
  compiler it treats every `import type` as a value import and reports 46 violations instead
  of 15. Adopting it would mean pinning a second TypeScript major as a dev dependency just so
  the tool can parse imports.
- **It cannot replace the whole guard.** The feature contract also requires an `index.ts`
  and a `README.md` in every module, and the ratchet refuses a fall that has not been banked
  and logs every absorbed rise. dependency-cruiser checks neither file presence nor
  ratchets, so adopting it would leave a script beside it. The issue ruled out two guards.
- **It is slower.** It takes about 12 s, against about 2 s for the script.

## Alternatives considered

- **Adopt dependency-cruiser and pin `typescript@5` for it.** Rejected. It reports the same
  findings, adds two dependencies, keeps a second TypeScript major in the tree, and still
  needs a script for the README check and the ratchet.
- **Use dependency-cruiser's `@swc/core` parser.** Not tried. It adds a native dependency,
  and it still leaves the README check and the ratchet outside the tool.

## Consequences

The guard stays a single file, `scripts/check-architecture.mjs`, with its test beside it. Its
blind spot is barrel re-exports: a module that re-exports an upward import moves the violation
into the barrel, and the guard flags the barrel, not the caller. Revisit this decision when
dependency-cruiser supports TypeScript 7, or when a rule is needed that depends on the
resolved module graph, such as a cycle or reachability rule, which the script cannot express.
The comparison config is quoted in issue #2240, so a future rerun does not have to start from
scratch.
