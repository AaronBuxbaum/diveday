# assists

A structured assist execution: live access, spend reservation, provider call, usage settlement and deterministic e2e provider answers.

## Public contract

Import values and types through `index.ts`. This is the execution boundary, not a catalog of prompt features. Each prompt belongs to its own concept module.

## Owns

- `e2e-fixtures.ts`
- `front-fixtures.ts`
- `store.ts`

## Does not own

Routes, UI, schema definitions and shared provider primitives stay in their existing layers.

## Invariants

This ownership move changes no validation, authorization, tenant scope, provider call, return shape or side effect. Existing tests retain their original project and timeout classification.
