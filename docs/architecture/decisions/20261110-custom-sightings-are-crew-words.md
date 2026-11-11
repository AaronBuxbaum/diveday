# 20261110-custom-sightings-are-crew-words — Autocomplete suggests; the crew can record any sighting

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** 20260813-marine-life-is-diveday-copy for trip sightings only; field-guide cards remain catalog selections.

## Context

The manifest's “Or say what you saw” box matched a sentence through an AI assist and could only propose the site's visible chips. The crew could neither search the full species catalog nor save an unfamiliar sighting for divers to read.

## Decision

The field is an ordinary free-text autocomplete, independent of AI availability. Suggestions come from the complete localized catalog. An exact suggested name saves its canonical species slug; any other nonblank text saves the crew's words, limited to 300 characters.

Custom sightings use the existing trip/site tally and its atomic increment and soft-delete paths. A nullable `custom_name` stores the display text. `species_slug` holds a `custom:`-prefixed SHA-256 digest of the normalized lowercase text for custom records. Normalization applies NFKC, trims outer whitespace and collapses inner whitespace. This prevents case and spacing variants from creating separate tallies without putting arbitrary text into identifiers. The first spelling remains the display label.

Custom sightings are displayed as escaped text in the site's public trip summary and included in exports. The three-species catalog summary limit does not suppress custom words. They never write to the species catalog or site guide, never become future preset chips, and do not enter the curated monthly photo shelf.

## Consequences

Catalog names remain localized for the reader. Custom words remain in the language the crew wrote; the application does not invent a translation or species identification. The existing tenant, sailed-departure, public-trip and rehearsal rules still govern the records. Sightings remain informational and cannot affect boarding, readiness or roll-call counts.

## Alternatives considered

- Keep the AI matcher: it cannot preserve an unfamiliar species or arbitrary crew words, and a normal entry field should not depend on AI availability.
- Add custom names to the catalog: rejected because a sighting is a dated record, not a reusable species definition or a site's standing claim.
- Put raw text in `species_slug`: rejected because display text and identity have different casing and whitespace needs, and every reader would have to guess whether a value names a catalog species.
