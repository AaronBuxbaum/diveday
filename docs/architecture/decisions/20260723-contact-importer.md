# 20260723-contact-importer — Import divers/customers from CSV with a published honesty table

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[competitive-strategy.md](../../product/competitive-strategy.md) makes data portability the wedge,
and orders it export-first: the "leave anytime" guarantee ships before the importer so the CSV
schemas are a contract, not a promise. That export landed
([20260722-full-shop-export.md](20260722-full-shop-export.md)) and its `contacts.csv` — one flat
row per person, names pre-split, best card with verification status, nitrox flag, sizes — is the
shape this importer reads back. The counter to the market's lock-in fear is a door that swings both
ways: a shop leaving EVE/DiveShop360/DiveAdmin/Smartwaiver must be able to *arrive* with its people,
cards, and sizes, not just leave with them.

The danger is that a fast import is a fast way to poison the safety spine. DiveDay gates boarding on
**verified** cards (glossary: a card is evidence, not clearance); an importer that trusted a source
file's "verified" column would let a migrating shop board divers against cards no one here ever
checked. Medical clearance is the same hazard in a worse costume — a "cleared" flag from another
system is not clearance under this shop's waiver.

## Decision

- One staff-gated surface: **Settings → Import contacts**. Upload a CSV (a rival's customer/cert
  export or DiveDay's own `contacts.csv`); the page previews every row with per-row validation
  before anything is written, and leads with a **published honesty table** stating what imports
  fully / partially / never — in the shop owner's words, matching the safety rules below exactly.
- **The safety spine holds through the import, mechanically:**
  - **Imported cards land `claimed` (`pending`), never `verified`.** Nothing in the write path can
    set `verified`; a source "verified/certified" column is noted and ignored. Staff re-verify at
    first contact, identical to a hand-entered card.
  - **No fabricated identifiers.** A card imports only with a recognized level *and* a real card
    number; a level with no number imports no card (a card with no number cannot be verified and
    would collide on the shop-unique index). An unrecognized level is left for a human.
  - **Medical/health answers never import (fail-closed).** Columns matching medical/liability
    patterns are detected and the shop is told, once, that they were left behind — collect a fresh
    signed waiver in DiveDay.
  - **Enriched air is a claim, not a fill authorization.** A nitrox card imports `pending` and only
    against a real nitrox card number; it never authorizes a fill until staff verify it.
  - **People match by email**, so a re-import updates the roster instead of duplicating it; a card
    number already on file is left untouched so an import never disturbs already-verified evidence.
- Layering mirrors the export: CSV parsing, column mapping, validation, and the honesty table are
  framework-free and DB-free in `src/lib/import.ts` — the same pure preparation runs in the browser
  for an instant preview and again on the server before any write, so the client is never trusted to
  have enforced the rules. The write is `commitContactImport` in `src/db/import.ts`, one
  transaction, scoped by the session's shop, never the URL.
- Access: **owner/manager only** (`canImportShopData` in `src/lib/authz.ts`, delegating to the
  export predicate), re-checked against the **database** on every commit
  (`canPersonImportShopData`) — a bulk write to the whole roster carries the same accountability
  weight as the export, and a demoted or disabled manager must lose it immediately, not at token
  expiry.
- **No new runtime dependency.** The RFC-4180 reader in `src/lib/import.ts` is symmetric with the
  export's writer (quoting, CRLF, the formula-injection apostrophe guard), so the bundle round-trips
  without a CSV library.

## Alternatives considered

- **Trust the source's verification status** — rejected on domain review: it is exactly the safety
  spine the strategy says never to bypass. The `claimed`/`verified` distinction is what makes a fast
  import honest instead of dangerous.
- **Fabricate a card number when one is missing** — rejected: a card with no number cannot be
  verified and collides on the unique index; "no number, no card" is honest and safe.
- **Import medical answers as satisfied** — rejected, fail-closed: another system's clearance is not
  clearance here.
- **Client-side commit / trust the browser preview** — rejected: the browser preview is UX only; the
  server re-prepares the raw text so the safety rules are enforced where they can't be edited.
- **A CSV library (papaparse, csv-parse)** — unnecessary given a symmetric reader is ~40 lines and
  the export already owns the writer; avoids a dependency and an ADR churn.
- **All-staff gating** — rejected for the same reason as the export: a roster-wide write is
  owner/manager work.

## Consequences

Easy: the export's documented CSV schemas now have a working intake, so "importable elsewhere" and
"arrive here" are both demonstrable in the demo shop; the pure module is shared by the preview and
the commit so the honesty rules live in one place. The migration guides (public pages) and scheduled
backups can build on this surface next. Hard: the header-alias map and level normalization are
best-effort against formats we can't all test from here — per-competitor verification belongs to the
migration guides, and the honesty table says so. Agencies outside the pg enum (RAID, CMAS, GUE)
flatten to `other` on import — safe (the card is `pending` and re-verified by hand) and disclosed
per-row, but a line for the migration guides; widening the enum is a separate schema change.
Specialty cards (deep/wreck/night/drysuit) are not part of the contact file and don't import at all;
the honesty table states this so a migrating shop re-enters them by hand rather than discovering the
gap on the boat. A schema change touching people/certifications/
nitrox/rental-fit now has an import decision as well as an export one; the drift test in
`src/lib/import.test.ts` pins the agency/level enums so a new rung can't silently fall out of the
importer.
