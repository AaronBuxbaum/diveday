# 20261027-staff-credential-history — Recorded staff credential history

- **Status:** Accepted (2026-10-27)
- **Date:** 2026-10-27

## Context

A renewal previously required deleting a card and re-entering it, losing the evidence the Safety report needs for an earlier sailing. A card's issue date is supplied by staff and does not establish when the shop recorded it.

## Decision

Keep one current credential per identity and append its kind and date fields when staff add, renew, correct or delete it. The version does not contain its name, identifier, issuer or review status. A revision rejects stale edits, reviews and deletions. Changes lock the person before the credential, matching erasure. A live crew departure boarding mark captures committed credential kind and date fields in the same database statement that writes the mark. It records an interval spanning the statement, under the shared boarding-evidence lock also held by diver captures; erasure holds the lock exclusively before person or trip locks. The report labels this as the state observed at the boarding mark, never as actual sailing time. An interval crossing a local midnight cannot establish the calendar day for the lapse check. Offline, unmarked and older entries, and observations containing a future-issued card, are unavailable and excluded from the checked denominator. The snapshot does not record the role at the mark, so the report does not judge whether recorded cards answer that role. A version timestamp is sampled inside a transaction and cannot prove when the transaction committed; a baseline establishes no earlier history.

The shop export includes history. Erasure deletes its versions and scrubs current and previously deleted credential identifiers. Current Team, Today and supervision readers use the single current row; a superseded expiry cannot generate a current reminder.

## Alternatives considered

- Insert every renewal as another current card: the existing identity constraint forbids the same card number and old expiries would remain on Today.
- Infer past state from the current card: corrections and backdating make that unreliable.

## Consequences

The report covers only live boarding observations; offline and unmarked sailings remain unavailable. A mark can precede or follow actual departure, so it does not prove a sailing-time credential. The data is personal and must follow tenant, export and erasure rules. If exact underwater evidence rather than a departure-time record is needed, record a separate boarding snapshot with explicit provenance.
