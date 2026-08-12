# FU-20260812-google-embed-attribution — Decide whether cropping Google's embed chrome is a licence problem

- **Status:** Open
- **Raised:** 2026-08-12 — the dive-route map cleanup that added `src/components/MapEmbed.tsx`
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/components/MapEmbed.tsx`, `src/components/DiveSiteMap.tsx`, `src/app/shop/[shopSlug]/dive-sites/_components/RouteEditor.tsx`, `src/lib/maps.ts`

## What I noticed

`MapEmbed` deliberately puts Google's own embed furniture outside the visible frame — it inflates
the `<iframe>` 64px past every edge of an `overflow-hidden` box, so the "View larger map" chip, the
pan/zoom controls, and the bottom bar carrying "Keyboard shortcuts", "Map data ©2026 …", "Terms"
and "Report a map error" all render off-window. This was asked for directly: on a route briefing
the frame is deliberately not interactive, so that furniture is unreachable noise sitting on top of
the reef a shop drew a line across.

Two of those cropped items are not decoration. **"Map data ©…" is the attribution** and **"Terms"
is the link to the terms the embed is served under**, and Google Maps Platform's terms have
historically required that provider attribution stay visible and unobscured. What is cropped is
only the *chrome*: the tile imagery itself still carries Google's baked-in "© 2026 Google"
watermarks across it, which are plainly visible in the rendered frame — so this is not a complete
removal of attribution, which is exactly why it is a judgement call rather than an obvious no.

The two surfaces affected are the diver-facing dive-site route briefing and the staff route editor.
The shop-address map on `/ready/[token]` deliberately still uses a plain `<iframe>` with all its
chrome, because that one is interactive and a reader may genuinely want "View larger map".

## Why it isn't already done

It is a licensing call, not an engineering one, and it needs someone who can accept the risk on
DiveDay's behalf. I was asked to remove the controls and I did; flagging the terms question and
carrying on is the right split, but leaving it only in a session message would lose it.

## Proposed change

Read the current Google Maps Platform terms for the keyless `output=embed` product (note it is not
the same product as the JS API, and the keyless embed's terms are the ones that apply here), then
pick one:

- **Accept it** — record the reasoning in an ADR amendment on
  `20260809-shop-drawn-dive-routes` and close this. The strongest argument for: the tile watermark
  remains, the frame is non-interactive by design, and a real "Open map" link to Google Maps sits
  in the caption directly under it.
- **Restore the attribution only** — drop the inflation to crop the corner controls and the
  keyboard-shortcuts hint while leaving the bottom bar's `©`/Terms strip inside the window. This
  needs a different mechanism than a symmetric inset, since the strip spans the bottom edge; the
  most likely shape is inflating top/left/right only and accepting the bottom bar.
- **Replace the provider** — a raster tile source with a friendlier attribution rule (or the shop's
  own uploaded satellite still, which `dive_sites.satellite_image_url` already models). This is the
  largest change and would need its own ADR.

Do **not** solve it by overlaying a fake attribution string — a hand-drawn "© Google" that the
provider did not render is worse than either honest option.

## Prompt

```text
Decide whether DiveDay may crop Google's embed chrome out of the dive-site route map.

Read first: src/components/MapEmbed.tsx (the whole file — its docstring explains why the iframe is
inflated symmetrically and why that geometry is load-bearing for route alignment), then
src/lib/dive-site-route.ts, src/components/DiveSiteMap.tsx, and
docs/architecture/decisions/20260809-shop-drawn-dive-routes.md.

The constraint that makes this non-obvious: a route waypoint is stored as a *percentage of the map
frame*, so the visible geography must not change. That is why the iframe grows symmetrically past
all four edges rather than being cropped or scaled — the centre and zoom stay put, and the pixels
inside the box are the pixels that were there before. Any alternative must preserve that or every
already-drawn route lands on the wrong water.

Check the current Google Maps Platform terms for the keyless `output=embed` map specifically (not
the JS API). Then either (a) accept the current behaviour and record why as an amendment to
docs/architecture/decisions/20260809-shop-drawn-dive-routes.md, or (b) change MapEmbed so the
attribution strip stays inside the window while the corner controls stay out. Never overlay a
hand-written attribution string.

Done when: the decision is written down in an ADR, and if code changed, `pnpm check` is green,
`pnpm e2e:run e2e/dive-sites.spec.ts --reporter=line` passes, and you have looked at the rendered
frame (node scripts/screenshot.mjs against a running pnpm dev, or a filtered visual-spec run) in
both light and dark. Delete docs/product/follow-ups/FU-20260812-google-embed-attribution.md as part
of the change.
```
