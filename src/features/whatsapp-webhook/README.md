# whatsapp-webhook

WhatsApp webhook signatures, challenges, delivery updates and inbound messages.

## Public contract

Import values and types through `index.ts`. The published contract keeps this use case separate from shared transport and unrelated features.

## Owns

- `rules.ts`
- `store.ts`: tenant/account-scoped delivered-message usage and reconciliation reader.

## Does not own

Routes, UI, schema definitions and shared provider primitives stay in their existing layers.

## Invariants

Signature verification precedes every write. Delivered usage is deduplicated by account and message fingerprint, keeps no recipient/content, and never invents a monetary charge from incomplete pricing metadata.
