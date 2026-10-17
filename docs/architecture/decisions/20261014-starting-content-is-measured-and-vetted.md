# 20261014-starting-content-is-measured-and-vetted — Starting content is measured by area and its photos are vetted

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Aaron's goal (2026-10-14): a Florida or Caribbean shop can assume 80% or more of its sites and
wildlife are already in DiveDay's starting content, and a new region is one follow-up command.
Nothing measured coverage. The dive-site catalog had no region, and its locality was guessed from
a timezone (issue #2477). Photographs were picked once and never re-checked: an audit on
2026-10-14 found 53 of 169 bundled files that broke the rules below. The procedure, the audit
and the tooling are in the **expand-content** skill.

## Decision

**The catalog is organised and measured by dive area, every template cites its sources, and every
bundled photograph passes written rules, a person's look and a ledger a test enforces.**

- **Dive areas** (`src/content/dive-areas.ts`). Each area has a country, a subdivision where the
  country holds other places, and stand-in timezones. Templates live in one file per area. The
  first-run offer matches areas to the shop's address (`catalogAreasForShop`); the timezone counts
  only where the address is silent.
- **Sources.** Every template cites two independent public pages; the prose stays DiveDay's.
- **Coverage denominators** (`src/content/coverage/<area>.json`). Each lists the named sites shops
  in an area run: recreationally divable, and on two independent lists. Once `promised`, an area
  stays at 80% or more (`src/content/coverage.test.ts`).
- **Photo ledger** (`src/content/photo-records.json`). `src/content/photo-rules.ts` refuses, with
  the reason recorded:
  - a licence outside the allowlist;
  - an original below the folder's bound;
  - a map, specimen, catch or aquarium;
  - an unreadable frame.

  A person judges species, life and framing on a contact sheet. `src/content/photo-records.test.ts`
  fails on:
  - a species without a vetted photo;
  - a template with neither a cover nor a reason;
  - an unrecorded file;
  - a hand-edited credit list.
- **One tool**, `pnpm content:photos`, replaces `scripts/fetch-marine-life-photo.mjs`.
- **A version bump publishes**: `seedDiveSiteCatalog` adds a new version to a database that
  already holds the slug.

## Alternatives considered

- **Count coverage against operator marketing ("365 dive sites").** These counts are
  unfalsifiable and inflated. A denominator built from named lists can be re-counted.
- **Judge relevance automatically** with an image model called from the script. That needs an API
  key and a runtime dependency. It would also replace the one check that caught a drawing, a
  skeleton and a wrong species with a guess. The rules filter, and a person decides.
- **Keep photos inline in templates.** That gives two places to record a cover. The ledger is
  already the record, so covers attach from it.

## Consequences

- A coverage claim is a number a test holds. A promised area that falls below 80% goes red.
- Every new species or template costs a photo decision before it can merge.
- Photographs that broke the rules were replaced or dropped. A landmark with no qualifying
  replacement shows no photo.
- An area without an official list has a weaker denominator, and its `method` says so.
