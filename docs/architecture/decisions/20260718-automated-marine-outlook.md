# 20260718-automated-marine-outlook — Use Open-Meteo as the marine-outlook fallback

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Trips own their dated conditions, but crew forecasts are not always available when divers first
view a scheduled charter. A useful fallback needs a specific offshore point, must not overwrite
crew judgment, and must remain plainly distinguishable from a dive briefing. The product cannot
present atmospheric visibility as underwater visibility.

## Decision

Store an optional latitude/longitude pair on each shop-owned dive site. For a future trip inside
ten days that has no crew prediction, request Open-Meteo's Marine API at that point and render a
non-persisted, labelled outlook for sea-surface temperature and waves. A crew prediction fully
replaces the outlook; clearing it restores the fallback. Underwater visibility stays absent until
the crew provides it.

## Alternatives considered

- **Persist or copy automated values into the trip** — stale provider output could be mistaken for
  crew confirmation.
- **Use atmospheric visibility for diving visibility** — the similarly named measurements do not
  describe the same safety-relevant condition.

## Consequences

Divers get a useful early planning signal and crew remains authoritative. Every mapped site makes
an outbound, time-bounded request when its public trip page is rendered, so an unavailable provider
simply omits the fallback. Revisit when a credible underwater-visibility provider is selected or
forecast traffic requires a cached provider adapter; migration is limited to the helper and its
source metadata.
