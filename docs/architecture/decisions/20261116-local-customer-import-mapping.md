# 20261116-local-customer-import-mapping — Map customer exports locally with reduced evidence authority

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The contacts importer previews and safely repeats recognized template exports, but unfamiliar customer headers require editing the source file or an optional external mapping assist. Aaron requested local mapping and recoverable imports without external accounts ([#4584](https://github.com/AaronBuxbaum/diveday/issues/4584)). Identity mappings affect which person receives imported evidence.

## Decision

Provide explicit staff column mapping separately from the optional assist. Manual mappings may identify a customer by name and email and map the existing safe supplemental fields. They cannot override recognized source headers or map age, waiver, medical, or verification evidence. The server validates posted mappings and prepares the raw CSV again.

Any effective manual mapping reduces authority for the entire file: level, specialty, and nitrox cards become pending; prior waiver acceptance is omitted. Recognized template imports retain their established trusted-record behavior. No imported booking history creates or moves a seat.

An owner/manager may request an advisory per-row roster match preview, scoped to the session shop and live people only. Commit retains its existing transactional match revalidation and locks. Repeated email rows merge; rows without email explicitly warn that each import creates a new record. Request identifiers correlate visible results with the current file revision only; they are not durable idempotency keys.

Recovery exports include rows with warnings or errors, original values, logical row numbers, and issue codes. Shared CSV escaping neutralizes formulas. Selecting a corrected file clears the old mapping and match snapshot.

## Alternatives considered

- Reuse the assist contract unchanged: cannot map customer identities.
- Trust manually mapped evidence: can attach another person's gate-clearing evidence after an identity mapping error.
- Require an external migration service: adds an account prerequisite to ordinary desk work.

## Consequences

Staff can map ordinary customer exports locally and inspect exactly which rows create or update divers. Manually mapped cards need staff review and waivers need collection in DiveDay. The roster preview is advisory, so concurrent edits may change final counts. Existing ledger/history deduplication remains the retry mechanism; no new financial or booking authority is introduced. Revisit the mapping evidence rule only with a separately reviewed attestation policy; doing so requires preparation and commit tests, not a data migration.
