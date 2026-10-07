# H-05: The product now uses explicit encrypted device snapshots rather than a live-only pilot.

- **Status:** Implemented
- **Human owner:** Product owner + dive operations lead

## Decision or approval needed

The product now uses explicit encrypted device snapshots rather than a live-only pilot. Approve or replace its 15-minute current / four-hour aging thresholds and retention at the earlier of 14 days after save or seven days after trip end.

## Minimum outcome to record

Named operations/privacy owners, accepted thresholds and retention, and the production stop rule for a missing/expired/corrupt device copy.

## Unblocks / follow-up

**Approved as-is 2026-07-24 (Aaron Buxbaum, acting operations/privacy owner):** the 15-minute current / four-hour aging thresholds and the retention at the earlier of 14 days after save or seven days after trip end are accepted unchanged. Production stop rule: a missing, expired, or corrupt device copy is **not** a boarding source — staff fall back to a fresh live load or the print/PDF manifest and never board from stale/absent data. **Still gated on V-02** outdoor field evidence before a real departure relies on the offline copy. See [offline manifest ADR](../../architecture/decisions/20260718-offline-manifest-snapshots.md). **Controls consolidated 2026-07-26 (Aaron Buxbaum):** device copies now save and refresh themselves automatically (on load, reconnect, tab focus, and a five-minute interval), with one remaining manual "Refresh now" control, and the staff-delete button is removed — expiry (unchanged: earlier of 14 days after save or 7 days after trip end) is the only way a copy goes away. Thresholds, retention duration, and the missing/expired/corrupt-copy stop rule are otherwise unchanged. See [manifest offline-copy automation ADR](../../architecture/decisions/20260726-manifest-offline-copy-automation.md).

Part of the [human decision log](README.md#decision-register).
