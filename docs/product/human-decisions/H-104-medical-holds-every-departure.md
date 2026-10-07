# H-104: Does a physician referral hold a diver on a departure that does not require the waiver?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Does a physician referral hold a diver on a departure that does not require the waiver?** The readiness engine raised `medical_review` (an answer referred the diver to a physician) and `medical_not_cleared` (the physician said no) only when the departure required the release, so a diver with an open referral read Ready on a trip whose waiver requirement was off (issue #2096).

## Minimum outcome to record

Whether the medical hold is a fact about the diver or about the departure.

## Outcome

**Decided 2026-10-06, confirmed 2026-10-07 (Aaron Buxbaum, in the project thread):** "2096: yes": medical blockers always apply, whatever the departure's waiver setting. `calculateReadiness` in `src/lib/readiness.ts` raises both medical codes from the diver's governing record on every departure; `waiver_not_sent`, `waiver_pending`, `waiver_expired` and the guardian line still follow the departure's own requirement. H-98 is unchanged: a clean release signed after a refusal is the governing record, so it clears the diver with its warning. Booking-time admission reads no medical state, so it still never refuses someone readiness would clear.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
