# H-20: Should the contact importer trust what a shop already had in its own system…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

Should the contact importer trust what a shop already had in its own system — landing imported certification and nitrox cards as `verified` rather than as unverified claims re-checked at first contact — on the reasoning that a record already in a system was manually verified there? And should this apply to all sources, including a loose spreadsheet? The assistant flagged the sharp edge (an imported level card clears depth gates, and an imported nitrox card authorizes enriched-air fills, on the strength of a CSV cell) and offered "keep it gated" and "verified, no confirm" alternatives before implementing.

## Minimum outcome to record

**Decided 2026-07-24: land imported cards `verified`, permanently flagged `imported`, surfaced for a soft one-tap staff confirm — for all sources including spreadsheets.** Boarding and depth clear on import; card expiry still applies, no card imports without a real number, and medical answers are never reconstructed. **The one exception, on `dive-domain-expert` recommendation (owner confirmed 2026-07-24):** the enriched-air *fill* waits for the confirm — an imported nitrox card gives plain air until a staffer taps confirm, because a nitrox card has no expiry backstop and a wrong fill is the highest-consequence failure. This reverses [20260723-contact-importer](../../architecture/decisions/20260723-contact-importer.md)'s "claimed, never verified" rule; it does not resolve the still-open waiver legal gates (H-01–H-03). Also authorized in the same decision: extend the free concierge switch offer to **all** switching pages and make it bidirectional (help a shop switch on *and* off DiveDay).

## Unblocks / follow-up

Implemented: `importedAt`/`importedFromLabel` on `certifications`/`nitrox_certifications`, verified-on-import write path, inline Confirm-card affordance + roster "to confirm" count, PDF import documents, and the rewritten `IMPORT_HONESTY_TABLE`. See [20260724-import-verified-cards](../../architecture/decisions/20260724-import-verified-cards.md).

Part of the [human decision log](README.md#decision-register).
