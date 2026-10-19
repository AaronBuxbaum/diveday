# 20261019-replace-google-maps — Eliminate Google Maps runtime dependencies in favor of open mapping providers

- **Status:** Proposed
- **Date:** 2026-10-19
- **Issue:** #2842

## Context

Following the adoption of open raster mapping (CARTO Positron / Voyager and OpenStreetMap) for the map-centric dive site library and catalog (ADR 20261019-map-centric-dive-sites), the remainder of the application continued to rely on Google Maps for three distinct functions:
1. Linkouts for directions or map inspection: `googleMapsUrl` generating links to `www.google.com/maps/search/?api=1&query=...` from meeting point cards (`TripArrivalCard`), email notifications, and dive site maps.
2. Meeting point frame embeds: `googleMapEmbedUrl` embedded in `ArrivalMap` on `/ready/[token]`.
3. Dive site terrain embeds: `googleTerrainEmbedUrl` embedded in `DiveSiteMap` and `RouteEditor`.

This dependency carried privacy, operational, and security costs:
- Content Security Policy (CSP) was forced to allow `maps.google.com` and `www.google.com` under `frame-src`, and probe images under `img-src`.
- Google was required as a named sub-processor in `src/app/privacy/page.tsx` and internationalized privacy bundles.
- Users navigating to maps or viewing frames were subject to Google tracking cookies, cross-origin hops, and third-party script/frame overhead.
- Ephemeral test and CI environments required mocking proprietary Google endpoints (`maps.google.com/**` and cleardot/transparent probe pixels).

## Decision

1. **External Navigation Linkouts (`googleMapsUrl` / `directionsUrl` / `appleMapsUrl`):**
   - Retain Google Maps (`googleMapsUrl`) and Apple Maps (`appleMapsUrl`) for external user navigation and directions linkouts (`TripArrivalCard`, `DiveSiteMap`, `PublicShopChrome`, and notification email templates). Standard directions linking defaults to Google Maps (or Apple Maps if requested/preferred by the user) without embedding Google Maps on-page.
   - Provide `openStreetMapUrl` and `directionsUrl(query, provider)` in `src/lib/maps.ts` for provider selection.

2. **OpenStreetMap Embeds (`osmMapEmbedUrl`):**
   - Replace Google's classic `output=embed` roadmap and terrain frames with OpenStreetMap export embeds: `https://www.openstreetmap.org/export/embed.html?bbox=...&layer=mapnik&marker=...`.
   - When coordinates and zoom are provided, compute a bounding box around the target location and render standard OSM tiles.
   - For route drawing in `RouteEditor` and `DiveSiteMap`, maintain identical overlay percentage coordinates and responsive frame aspect ratios over the provider-neutral embed.

3. **Retire Google Maps Frame and Reachability Probes:**
   - Remove `maps.google.com` and `www.google.com` from `MAP_FRAME_HOSTS` in `src/lib/content-security-policy.ts`.
   - Set `MAP_FRAME_HOSTS = ["https://www.openstreetmap.org"]`.
   - Update `MAP_REACHABILITY_PROBES` to probe OpenStreetMap tile / static asset availability (e.g. standard open tile probe) rather than Google cleardot/transparent images.

4. **Retire Google Sub-Processor Listing:**
   - Because Google Maps embeds and probes are eliminated, Google is no longer a data sub-processor for embedded map rendering.
   - Remove Google from the sub-processor list in `src/app/privacy/page.tsx`, `diver.json` (en-US & es-ES), and corresponding E2E assertions in `e2e/marketing.spec.ts`. (Note: Push vendor naming mentioning Google FCM remains untouched under `pushTerm`).

## Alternatives considered

- **Apple Maps (`maps.apple.com`):** Offers good mobile deep-linking on iOS, but redirects to proprietary web experiences on desktop without open raster embed capabilities.
- **Client Leaflet Rendering for all frames:** While ideal for full interactivity, replacing the lightweight `iframe` embed contract in `RouteEditor` and `ArrivalMap` would require client-side hydration and larger initial bundles on server-rendered routes. OpenStreetMap export embeds preserve the zero-SDK, zero-key, iframe-isolated security model.

## Consequences

- Completely eliminates Google tracking and third-party frame surface from map components.
- Simplifies CSP `frame-src` and `img-src` allowances.
- Eliminates Google from privacy disclosures for embedded maps.
