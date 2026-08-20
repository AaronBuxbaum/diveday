# 20260809-shop-drawn-dive-routes — A shop draws its own dive route, as waypoints on a fixed frame

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

A dive briefing's most useful picture is the one that says *this is where we swim*. DiveDay had it —
a satellite frame with a curve drawn over it, a start dot and a finish dot — for exactly three dive
sites, because the three routes were hand-authored SVG path strings in a lookup table
(`src/lib/dive-site-map.ts`) keyed by **site name**:

```ts
"Molasses Reef": { path: "M 16 67 C 25 48, 31 32, 44 29 S 66 38, 72 52 S 67 73, 84 78", … }
```

So the feature was unavailable to every shop that uses the product, and unavailable to DiveDay for a
fourth site without an engineer writing Bézier control points by hand. A shop asked for the obvious
thing: a way to set the route itself, ideally by clicking it.

The hard part is not the drawing. It is what a waypoint *means*.

## Decision

**A route is a list of waypoints stored as percentages of the site's satellite frame**
(`dive_sites.route_points`, `[{x, y}]` in a 0–100 box, origin top-left), alongside the frame those
percentages refer to: the site's existing `forecast_latitude`/`forecast_longitude`, plus a new
`route_zoom`. The briefing overlays an SVG with `viewBox="0 0 100 100"` on the embed, so a percentage
*is* the coordinate the drawing happens in.

### Attribution geometry (2026-08-16)

The current [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms),
section 3.2.2(b), requires all attribution supplied by Google to remain displayed and not be
modified, obscured, or deleted. The route map therefore does not crop Google's bottom attribution
strip. `MapEmbed` keeps the original symmetric iframe dimensions and the original route window,
then exposes the provider-rendered strip in an additional 4rem band below that window. The route
SVG and editor click surface remain constrained to the original-height inner window, so existing
percentage waypoints still land on the same map pixels. No hand-written attribution is substituted.

**The map cannot be panned while drawing.** This is the load-bearing constraint, not an unfinished
edge. Percentages are meaningful only against a frame the viewer can reproduce, and the frame comes
from a third-party `<iframe>` whose centre and zoom we cannot read back. If the shop could drag the
embed, it would draw a perfect line over the reef and a diver would read that line over open sand —
a *plausible, confident, wrong* picture on the surface whose whole job is telling somebody where
they are going. So the editor's iframe is `pointer-events-none`, and the two things that move the
frame are the two things that persist: the coordinate fields (watched live as they are typed) and a
zoom control whose value is stored with the points.

**Clicked points, drawn as a Catmull-Rom spline** (`routePathD`), converted to the cubic Béziers SVG
speaks. The spline interpolates — every clicked point is on the curve — so the smoothing never walks
the line off the reef the staffer aimed at, and a five-click route looks like the swim they were
picturing rather than a polyline they now have to add points to soften.

**The three seeded routes became ordinary rows.** `src/lib/dive-site-map.ts` and its name-keyed
lookup are deleted; the demo shop's Molasses Reef, Spiegel Grove and Christ of the Abyss carry
`route_points` seeded from the old anchor points, with their labels and notes moved into seed data
where the prose belongs. There is no longer a code path that gives DiveDay's own sites something a
customer's site cannot have.

## Alternatives considered

- **Latitude/longitude per waypoint.** The more universal unit, and the wrong one here: turning a
  lat/lng back into a screen position needs the projection, centre and zoom of an embed we cannot
  query, so the placement would be re-derived by guesswork at render time. That trades a constraint
  we can state and enforce for an error nobody can see — the failure mode is a line that lands
  slightly off the reef, which reads as correct.
- **A real map SDK (Mapbox GL, Google Maps JS) with a draggable map and true geographic pins.** The
  right answer eventually, and it solves the panning constraint outright. Rejected for now on cost:
  a new runtime dependency, a browser API key with a referrer allowlist to keep correct across every
  preview deployment and the embed origin, and a third-party script under a CSP that currently
  allows none — the same shape ADR 20260804-aws-location-address-lookup rejected for the address
  type-ahead. Percent-of-frame is upgradable to it later; nothing above assumes otherwise.
- **Keep uploading a route image (`route_image_url`, which already exists).** It works today and
  stays. It is not the same thing: it needs a shop with an image editor and a satellite screenshot,
  it cannot be adjusted after the fact, and it does not compose with the live map the briefing
  already draws. Drawing is the version a shop can actually do at the counter.
- **Freehand drag-to-draw instead of clicked waypoints.** Nicer for a mouse, worse for everything
  else: it produces hundreds of points to store and smooth, it is unusable with a trackpad on a boat
  and awkward on a phone, and "undo the last point" — the control staff reach for most — has no
  meaning. Twelve clicks is the whole vocabulary.

## Consequences

- `dive_sites` gains `route_points`, `route_label`, `route_note`, `route_zoom` (additive; the
  destructive-migration guard passes).
- A site with no coordinates can have no route, and clearing a site's coordinates clears its route
  on save (`parseDiveSiteForm`) rather than leaving a line over nothing. The staffer's edit is the
  deliberate act; the route is what stopped meaning anything.
- The editor is a pointer surface — clicking waypoints onto a picture is not keyboard-drawable, and
  this is a configure-once desk task. Everything *around* the drawing (label, note, zoom, the stored
  points themselves) is an ordinary form field, so the record is reachable and the form posts and
  saves identically with or without JavaScript.
- `MAX_ROUTE_POINTS` (12) bounds what a stuck finger or a crafted POST can store on a row every trip
  page reads. `parseRoutePoints` never throws: untrusted input degrades to "no route".
- Changing a site's zoom after a route is drawn moves the frame under the line. The editor shows the
  route redrawn at the new zoom immediately, so the mismatch is visible while the shop is still
  standing in front of it rather than discovered by a diver.
