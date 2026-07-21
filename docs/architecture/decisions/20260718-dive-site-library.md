# 20260718-dive-site-library — Keep reusable dive-site briefs separate from trips

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Divers need a rich, credible idea of a site before booking, while staff repeatedly schedule the
same locations. A trip's date-specific forecast must remain independent of reusable location,
route, and marine-life content. Every record remains shop-scoped.

## Decision

Use immutable versions in a DiveDay-maintained common-site catalog. A shop imports a version into
its own `dive_sites` library, retaining its source template/version even after local edits, so an
update can be visible without overwriting the shop. A trip may reference one library record; the
site carries its location/media, educational field cards, and plan while the trip owns forecasts.

## Alternatives considered

- Store all content directly on a trip — duplicates briefing work and makes reuse awkward.
- Integrate a map, weather, or asset-hosting provider now — adds vendor commitments before the
  shop has established its workflow.

## Consequences

Staff can create, duplicate, and selectively edit useful site briefs without altering a trip's
conditions. Site edits intentionally update every linked trip; staff copy first when a one-off
brief is needed. Revisit when a provider-backed mapping, forecast, or media-upload workflow is
selected; migration means adding provider identifiers while retaining the existing URL fields.
