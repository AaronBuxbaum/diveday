# 20261022-one-shared-basemap — Draw every map on one shared imagery basemap

- **Status:** Proposed
- **Date:** 2026-10-22
- **Issue:** #2930, #2943

## Context

The dive-site library and catalog drew CARTO Positron through Leaflet, while the route editor
and the trip briefing framed an OpenStreetMap embed: two styles on neighboring pages (Aaron,
2026-10-22). Positron paints water one flat gray, so a zoomed-in reef read as an empty square,
and CARTO now refuses unkeyed requests (#2930). A route is stored as percentages of its frame
(ADR 20260809-shop-drawn-dive-routes), so a new frame must fit exactly the box the old embed fitted.

## Decision

1. **One basemap**, `src/lib/basemap.ts`: Esri World Imagery under Esri's place labels, from the
   keyless `server.arcgisonline.com` tile service, credited as Esri asks. Levels past 18 scale
   level 18.
2. **One Leaflet setup**, `src/components/map/leaflet-basemap.ts`, used by the interactive
   `SiteMap` and the still `RouteFrameMap`. It follows its own box with a `ResizeObserver`, so a
   resize lands in the frame it happens in.
3. **Route frames are Leaflet, held still**: no drag, zoom or keyboard, fitted at whole zooms to
   `routeFrameBounds`, the same box the OpenStreetMap embed fitted, inside the same inflated box
   (`MapEmbed`). Stored routes keep their water. This supersedes item 2 of ADR
   20261019-replace-google-maps for the route frames; the `/ready` meeting point stays an
   OpenStreetMap embed, since it has an address and no coordinates.
4. **Tests never fetch a tile**: `e2e/fixtures.ts` answers every basemap host with one flat sea
   tile, so CI needs no key and captures do not change when the provider re-renders a coast.
5. **Place names are vector text when there is a key** (#2943): raster labels blur on a retina
   screen. With `NEXT_PUBLIC_ARCGIS_API_KEY`, Esri's `arcgis/imagery/labels` vector style draws
   through MapLibre (`maplibre-gl`, `@maplibre/maplibre-gl-leaflet`, new runtime dependencies
   loaded only then) between the imagery and the markers; the CSP names its hosts only then. No
   key, or any MapLibre error, draws the raster labels.

## Alternatives considered

- **CARTO Voyager with a key** — blue water, still flat; needs a key in every build.
- **Esri World Ocean Base** — real bathymetry, but sparse past level 13, where routes are drawn.
- **OpenStreetMap standard tiles** — open, but flat water and a tile policy against app traffic.
- **Esri's keyed static tiles** for the labels — still raster, still soft.
- **`esri-leaflet-vector`** — the same layer plus an `esri-leaflet` dependency.

## Consequences

- One style and one code path for every map; a basemap change is one file.
- The keyless imagery endpoint carries no usage guarantee; moving the imagery onto the key is
  a URL change in `src/lib/basemap.ts`.
- The key is public in the browser; a referrer restriction in the ArcGIS dashboard guards it.
- CI runs keyless, so vector labels are checked on a deploy with the key.
- Imagery is darker than the brand surfaces; pins, the shop's stem and the cards carry their own
  light edges.
