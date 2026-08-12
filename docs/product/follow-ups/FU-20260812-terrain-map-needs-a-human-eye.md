# FU-20260812-terrain-map-needs-a-human-eye — Look at the terrain map on real dive sites before trusting it everywhere

- **Status:** Open
- **Raised:** 2026-08-12 — branch `claude/shop-booking-updates-kko48a`, the satellite → terrain map switch
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/maps.ts`, `src/components/DiveSiteMap.tsx`, `src/app/shop/[shopSlug]/dive-sites/_components/RouteEditor.tsx`

## What I noticed

The dive-site map embed moved from Google's satellite view (`t=k`) to its terrain view (`t=p`),
because a satellite photo of open water is a flat blue rectangle and the thing a diver actually
wants — how the bottom is shaped — is what the photo cannot show. Terrain renders bathymetric
shading and depth contours offshore, which is the right kind of picture.

What I could not check is **how much bathymetry Google actually has at any given shop's sites**.
Coverage is uneven: it is good over well-surveyed coastal shelf and can be nearly blank over some
tropical reef and inland-quarry locations, where terrain may render as plain water with a coastline
and *less* visual information than the satellite photo carried. The e2e suite cannot answer this —
the embed is a third-party iframe that renders nothing deterministic in CI, which is exactly why
the visual baselines watch the SVG route overlay and not the map under it.

The route overlay itself is unaffected either way: it is drawn in frame coordinates at the site's
own stored zoom, and the two styles share a projection.

## Why it isn't already done

It needs someone to open a handful of real dive sites in a browser and look — Key Largo, a Cozumel
wall, a European quarry — and say which reads better. That is a judgment about pictures, and I
cannot see them.

## Proposed change

Open `/s/blue-mantis` → a trip with a site briefing, and `/shop/blue-mantis/dive-sites/<id>` (the
route editor draws on the same embed), at a few real coordinates. Then either:

- **Terrain reads better** → nothing to do; delete this file.
- **It is worse at some sites** → the honest fix is a per-site choice, since the right answer is a
  property of the water: a `map_style` column on `dive_sites` (`terrain` | `satellite`), defaulting
  to terrain, with a two-option control beside the coordinates in `SiteFields.tsx`.
  `googleTerrainEmbedUrl`/`googleSatelliteEmbedUrl` become one function taking the style.
- **It is worse everywhere** → revert `src/lib/maps.ts` to `t=k` and put the wording back
  (`site.terrainMapTitle`, `site.terrainViewIllustrative`, the route editor's `mapAriaLabel` and
  `needsCoordinates`, and `trip.siteMapAlt`).

What I would *not* do is add a viewer-side toggle: the route is drawn against one frame, and giving
a diver a control that changes what is under the line invites exactly the mismatch the
never-pannable rule exists to prevent.

## Prompt

```text
Read docs/product/follow-ups/FU-20260812-terrain-map-needs-a-human-eye.md, then src/lib/maps.ts and
src/components/DiveSiteMap.tsx.

The dive-site map embed switched from Google satellite (t=k) to terrain (t=p) on 2026-08-12.
Terrain shows bathymetry, which is the point — but Google's offshore coverage is uneven, and nobody
has looked at it on real coordinates yet.

Do this: run pnpm dev, then node scripts/screenshot.mjs on a public trip page with a site briefing
and on /shop/blue-mantis/dive-sites/<id>, and look at the frames. If terrain reads worse at some
sites, add a per-site `map_style` column (terrain | satellite, default terrain) with a control in
SiteFields.tsx beside the coordinates, collapse googleTerrainEmbedUrl/googleSatelliteEmbedUrl into
one style-taking function, and follow the schema-change skill for the migration. Do NOT add a
viewer-side toggle: the route overlay is drawn against one fixed frame.

Checks: pnpm check, and pnpm e2e e2e/dive-sites.spec.ts --reporter=line. Delete this follow-up file
as part of the change.
```
