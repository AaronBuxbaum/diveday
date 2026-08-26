# 20260826-conservation-notes-and-commitments — Site-level conservation notes and shop commitment claims

- **Status:** Accepted
- **Date:** 2026-08-26
- **Issue:** [#729](https://github.com/aaronwittman/diveday/issues/729)

## Context

Every dive shop operates in natural marine environments and communicates rules and best practices
to protect reefs and wildlife. However, DiveDay cannot verify third-party certifications or environmental
practices without becoming an audit body, which would violate our marketing and claims policies
(docs/product/marketing.md).

At the same time, dive operators need structured ways to share site-specific rules (e.g. marine sanctuary
guidelines, mooring buoy rules, buoyancy awareness) on dive briefings, and to communicate their operational
commitments (such as Green Fins membership, PADI AWARE partnership, or no-gloves policies) on their public schedule.

## Decision

Implement conservation communication in two distinct, non-overlapping mechanisms:

1. **Site-level Conservation Notes (`dive_sites.conservation_note`):**
   - Free-text prose written by the shop crew describing site-specific guidelines and regulations.
   - Displayed directly on diver-facing dive briefings and trip prep views alongside the dive plan and field guide.
   - Synchronized as an optional field in published catalog templates while preserving shop edits.

2. **Structured Shop Conservation Commitments (`shops.conservation_commitments`):**
   - A curated set of stable codes representing verifiable or self-reported operational practices:
     - `green_fins_member`, `padi_aware_partner`, `mooring_buoys_only`, `no_touch_policy`, `no_gloves_policy`, `reef_cleanup_dives`, `lionfish_containment`, `coral_nursery_support`.
   - Managed by shop owners/managers in shop settings.
   - Displayed as structured badges on the public shop schedule page with an explicit, unambiguous disclaimer:
     *"Stated by the shop, not verified by DiveDay."* / *"Declarado por el centro, no verificado por DiveDay."*
   - Never presented as DiveDay audit stamps, verification badges, or sustainability endorsements.

3. **Export and Data Portability:**
   - Both fields are included in CSV export datasets (`dive_sites.csv` and `shop.csv`) to uphold data ownership invariants.

## Alternatives considered

- **DiveDay-verified sustainability badges** — rejected because DiveDay is operational software, not an assessment agency; claiming verification would constitute greenwashing.
- **Free-text shop commitments** — rejected because unstructured text cannot be reliably localized or surfaced consistently, and codes ensure multilingual parity (`en-US` and `es-ES`).
- **Post-dive recap carbon or impact reporting** — rejected because it requires granular, validated per-dive log records that do not yet exist (deferred to future logging capabilities).

## Consequences

- Divers see clear conservation guidelines when reviewing trip itineraries and dive briefings.
- Shops can highlight their environmental practices without misrepresenting DiveDay as a verifying body.
- Both English and Spanish locales have complete, verified copy for all commitment codes and disclaimer strings.
