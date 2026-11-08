# sns-webhook

An SNS envelope verified for the expected topic, freshness and certificate before a webhook proceeds.

## Public contract

Import values and types through `index.ts`. The published contract keeps this use case separate from shared transport and unrelated features.

## Owns

- `gate.ts`
- `rules.ts`

## Does not own

Routes, UI, schema definitions and shared provider primitives stay in their existing layers.

## Invariants

This ownership move changes no validation, authorization, tenant scope, provider call, return shape or side effect. Existing tests retain their original project and timeout classification.
