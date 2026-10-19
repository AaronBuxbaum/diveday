# 20261019-replace-google-maps — Eliminate Google Maps runtime dependencies in favor of open mapping providers

- **Status:** Proposed
- **Date:** 2026-10-19
- **Issue:** #2842

## Context

Following open raster mapping adoption for the dive site library and catalog (ADR 20261019-map-centric-dive-sites), the application continued relying on Google Maps for:
1. Direction linkouts from meeting cards, emails, and dive site views.
2. Meeting point embeds in `ArrivalMap` on `/ready/[token]`.
3. Terrain embeds in `DiveSiteMap` and `RouteEditor`.

This required:
- CSP allowances for `maps.google.com` and `www.google.com` in `frame-src` and `img-src`.
- Google listed as a sub-processor in privacy bundles.
- Third-party tracking overhead, cookies, and mock dependencies in CI.

## Decision

1. **Direction and External Linkouts:**
   - Retain Google Maps (`googleMapsUrl`) and Apple Maps (`appleMapsUrl`) for user directions and external linking (`TripArrivalCard`, `DiveSiteMap`, `PublicShopChrome`, emails).
   - Default external directions links to Google Maps (or Apple Maps if requested/preferred).
   - Provide `openStreetMapUrl` and `directionsUrl(query, provider)` in `src/lib/maps.ts`.

2. **OpenStreetMap Embeds (`osmMapEmbedUrl`):**
   - Replace Google's `output=embed` frames with OpenStreetMap export embeds: `https://www.openstreetmap.org/export/embed.html?bbox=...&layer=mapnik&marker=...`.
   - Calculate bounding boxes around target coordinates for responsive frames.
   - Maintain percentage overlay coordinates in `RouteEditor` and `DiveSiteMap`.

3. **CSP and Probes:**
   - Remove Google hosts from `MAP_FRAME_HOSTS`.
   - Set `MAP_FRAME_HOSTS = ["https://www.openstreetmap.org"]`.
   - Probe OpenStreetMap tile/asset reachability in `MAP_REACHABILITY_PROBES` instead of Google probe pixels.

4. **Privacy and Sub-Processors:**
   - Remove Google as an embedded map sub-processor in `src/app/privacy/page.tsx`, `diver.json` (en-US, es-ES), and `e2e/marketing.spec.ts`. FCM push references remain untouched.

## Alternatives considered

- **Apple Maps Embeds:** Good iOS deep-linking, but lacks open embed options for desktop web.
- **Leaflet in all frames:** Requires client hydration where lightweight `iframe` embeds suffice.

## Consequences

- Eliminates Google tracking and third-party frame surface from map components.
- Simplifies CSP `frame-src` allowances and eliminates Google from embedded map privacy disclosures.

