# sites

The water: dive sites and their briefings, closures, tides, marine life and conservation.

## Owns

- Sites: `dive-sites/`, `dive-site-page.ts`, `dive-site-memory.ts`, `dive-site-closures.ts`,
  `site-history/`, `site-brief.ts` (a prompt module).
- Tides: `tide-predictions.ts`, `tide-stations.ts`, `departure-tides.ts`.
- Life and conservation: `marine-life-requests.ts`, `month-sightings/`, `trip-sightings.ts`,
  `conservation.ts`.

## Does not own

Site difficulty codes (`src/lib/dive-site-difficulty.ts`), the sites a trip plans to visit
(`src/features/trips/trip-planned-sites.ts`) and the content catalog (`src/content/`).

## Invariants

- Every sentence a diver reads on a briefing is the shop's own row; the catalog is a view
  (`?view=catalog`), not a second route tree.
- Dive-site difficulty is one of three codes, never free text (ADR 20260813-dive-site-difficulty-is-a-code).
- Conservation facts are quantified and shop-attributed; no staff identity crosses a bearer link.
