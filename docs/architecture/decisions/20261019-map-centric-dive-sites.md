# 20261019-map-centric-dive-sites — Map-centric dive sites library and catalog view

- **Status:** Proposed
- **Date:** 2026-10-19
- **Issue:** #2840

## Context

The staff dive-site library (`/shop/[shopSlug]/dive-sites`) and its catalog view (`?view=catalog`) currently display primarily as text ledgers (`SiteLibraryLedger`, ADR 20260827-the-shops-shelves). Dive operations and trip scheduling are fundamentally spatial: dive operators assess weather, swells, tides, mooring positions, and transit distance visually on the coastline relative to their harbor or dock.

Aaron directed: "the Dive Sites page (and the Dive Sites catalog) should be map focused first, centered around where the dive shop is. You should still be able to see the list of dive sites, but the primary method of working through dive sites will be through the map itself."

## Decision

1. **Split-Screen Map-First Layout:**
   - Both the shop site library (`/shop/[shopSlug]/dive-sites`) and the catalog view (`?view=catalog`) transition to a primary map view with a linked master-detail list.
   - On desktop (`lg` and above), the layout presents an interactive map prominently alongside the site list.
   - On mobile/tablet viewports, the map takes the primary screen estate, with a collapsed/toggleable bottom sheet or drawer for the list of sites.

2. **Centering & Anchoring:**
   - The map centers automatically on the shop's geographic anchor (`shopSearchAnchor`, derived from the shop's address coordinates or its nearest dive site).
   - If the shop has not configured location coordinates yet, the catalog displays its existing location-required prompt.

3. **Pins and Interactive Selection:**
   - Pins are plotted for each site with geographic coordinates (`forecastLatitude`, `forecastLongitude`).
   - The shop location is clearly marked with a distinct anchor icon/pin.
   - Interactivity is bidirectionally synchronized: clicking a pin on the map highlights and scrolls the corresponding site in the list; hovering or selecting a site row in the list highlights and centers the pin on the map.
   - In the catalog view, clicking a pin presents the template summary with the direct "Import" or "Preview" action.

4. **Zero-Key Open Client Map Engine:**
   - To respect CSP restrictions and avoid paid third-party API keys or unvetted scripts (ADR 20260809-shop-drawn-dive-routes), the interactive multi-pin map uses an open-source, client-side vector/raster mapping library (such as Leaflet with open bathymetric / marine topographic tiles), ensuring full offline/graceful-degrade capabilities consistent with `MapFrame`.

## Alternatives considered

- **Keep the map as a secondary preview modal**: Discarded because spatial exploration is the primary way staff evaluate dive conditions, mooring availability, and transit logistics.
- **Third-party proprietary map SDKs (Mapbox / Google Maps JS API)**: Discarded due to runtime API keys, referrer token management across ephemeral preview environments, and external network tracking vulnerabilities.
- **Static SVG plotting without tiles**: Discarded because it cannot provide real-world coastline and bathymetric context across varying zoom levels.

## Consequences

- The site library ledger remains fully accessible and keyboard navigable as a companion list.
- Working through dive sites matches real-world dive operations.
- ADR index and design documentation updated.
