# 20261109-evidence-key-history — Keep signing key identity with evidence seals

- **Status:** Proposed
- **Date:** 2026-11-09

## Context

Waiver and course-form field versions currently identify what was signed, but not which key signed
it. Rotating the signing secret invalidates historical evidence. Re-sealing all history would
obscure whether it was intact before rotation.

## Decision

Keep immutable signed fields and their field-version numbers. An opt-in key registry selects one
active key and retains verification keys by stable ID. New digests use an authenticated key-ID
envelope in the existing text hash column. Verification selects exactly that ID, never tries all
keys. Historical untagged hashes require an explicitly retained `legacy` key when the registry is
configured. Unconfigured installations retain their existing digest format and secret selection.

Malformed registry configuration refuses signing and verifies nothing. Missing IDs refuse
verification. IDs are authenticated along with the canonical payload, so aliases cannot rewrite
provenance. This adds no database columns, historical updates, key generation, deployment, or
automatic secret rotation.

A runbook must separate routine retirement (retain verification keys) from compromise (removing
one invalidates its evidence; never bulk re-seal to hide that loss). Existing invalid and erased
record semantics remain unchanged.

## Alternatives considered

- Re-seal every row — erases useful provenance and could legitimize already-invalid evidence.
- Add key columns — requires broad schema plumbing for information already carried by the seal.
- Try every previous key — cannot identify provenance and makes revocation ambiguous.

## Consequences

Operators must retain the keys required by historical evidence. A key-ID registry is not an
external notarization service and cannot prove authenticity after the key is compromised.
If independently verifiable evidence is required later, a new envelope algorithm can coexist
with these identifiers without changing the immutable field serialization.
