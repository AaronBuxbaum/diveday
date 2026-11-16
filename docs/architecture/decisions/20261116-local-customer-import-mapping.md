# 20261116-local-customer-import-mapping — Map customer exports locally with reduced evidence authority

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The contacts importer previews and safely repeats recognized template exports, but unfamiliar customer headers require editing the source file or an optional external mapping assist. Aaron requested local mapping and recoverable imports without external accounts ([#4584](https://github.com/AaronBuxbaum/diveday/issues/4584)). Identity mappings affect which person receives imported evidence.

## Decision

Provide explicit staff column mapping separately from the optional assist. Manual mappings may identify a customer by name and email and map the existing safe supplemental fields. They cannot override recognized source headers or map age, waiver, medical, or verification evidence. The server validates posted mappings and prepares the raw CSV again.

Any effective manual mapping reduces authority for the entire file: level, specialty, and nitrox cards become pending; prior waiver acceptance is omitted. Recognized template imports retain their established trusted-record behavior. No imported booking history creates or moves a seat.

An owner/manager may request an advisory per-row roster match preview, scoped to the session shop and live people only. Commit retains its existing transactional match revalidation and locks. All mapping modes, including recognized templates and assisted files, refuse every row in an email group when names disagree within the file or with the locked live roster record. Names compare only after Unicode presentation, case, and whitespace normalization; token order, suffixes, accents, and nicknames are never inferred. The advisory preview identifies these conflicts and commit checks again, including concurrent insert winners. No contact, notes, history, or evidence is attached from a refused group. Recognized headers establish field meaning, not shared-email identity; conflicting names require correction outside import. Matching identity presentation may refresh. Repeated email rows with matching names merge; rows without email explicitly warn that each import creates a new record. Request identifiers correlate visible results with the current file revision only; they are not durable idempotency keys.

Recovery exports include rows with warnings or errors, original values, logical row numbers, and issue codes. Shared CSV escaping neutralizes formulas. Selecting a corrected file clears the old mapping and match snapshot.

## Alternatives considered

- Reuse the assist contract unchanged: cannot map customer identities.
- Trust manually mapped evidence: can attach another person's gate-clearing evidence after an identity mapping error.
- Require an external migration service: adds an account prerequisite to ordinary desk work.

## Consequences

Staff can map ordinary customer exports locally and inspect exactly which rows create or update divers. Manually mapped cards need staff review and waivers need collection in DiveDay. The advisory preview may change before commit. Existing history deduplication handles retries; financial and booking authority is unchanged. Evidence attestation needs separate review and tests.

## Validation

The household-name regression failed before the fix. Tests preserve existing verified cards and waivers, reject child notes, and cover stale previews, strict names, whole-group refusal, safe recovery exports and submit counts. Independent security and dive-domain source reviews were clean. Browser verification remains restricted.
