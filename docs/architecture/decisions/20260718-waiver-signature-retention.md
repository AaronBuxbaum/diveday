# 20260718-waiver-signature-retention — Keep waiver evidence immutable in-house for v1

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

M3 needs a mobile-first waiver that a diver can complete before arrival without making a
third-party e-signature vendor a prerequisite. A signed waiver is safety and legal evidence: its
template must not change underneath a completed record, a later template edit cannot rewrite
history, and an expired or superseded link must never grant access to a record. The first slice
must work in a zero-infrastructure PGlite environment and leave a small, testable seam for a
future provider.

## Decision

Store a new immutable waiver record for every issued completion link. The record snapshots the
template title, version, and body at issue time; completed records are never edited. V1 uses an
in-house `SignatureProvider` with typed name, explicit consent, timestamp, and request metadata.
It may accept a drawn signature later, but it does not claim cryptographic non-repudiation. Tokens
are generated with Node crypto, only a SHA-256 hash is stored, and requests expire by default.

The provider interface lives in `src/lib/signatures.ts`. No route, database query, or component may
call a vendor SDK directly. A future provider must normalize its result into the same immutable
evidence shape and add an ADR before it is enabled.

## Alternatives considered

- **Adopt an e-signature SaaS now** — adds an account, network dependency, and product decision
  before the core completion experience has been validated.
- **Store only a mutable person-level waiver flag** — loses template/version evidence and makes
  audit history impossible.
- **Store raw completion URLs** — turns a database read into a bearer-token disclosure.

## Consequences

The first release is easy to run and test locally, and all historic records remain inspectable
against their actual text. It does not yet meet the stronger assurance or delivery guarantees of a
specialist e-signature service; legal requirements can trigger a provider implementation and a
migration that preserves existing evidence. Retention duration, deletion requests, and jurisdiction
specific language remain shop-policy work before production deployment.
