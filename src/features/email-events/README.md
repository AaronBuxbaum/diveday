# email-events

SES delivery and inbound event notifications normalized after envelope verification.

## Public contract

Import values and types through `index.ts`. The published contract keeps this use case separate from shared transport and unrelated features.

## Owns

- `inbound.ts`
- `rules.ts`

## Does not own

Routes, UI, schema definitions and shared provider primitives stay in their existing layers.

## Invariants

This ownership move changes no validation, authorization, tenant scope, provider call, return shape or side effect. Existing tests retain their original project and timeout classification.
