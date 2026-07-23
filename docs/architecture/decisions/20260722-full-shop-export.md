# 20260722-full-shop-export — Ship a self-serve full-shop export as a ZIP of documented CSVs

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

[competitive-strategy.md](../../product/competitive-strategy.md) makes data portability the wedge
against DiveAdmin (API only ingests; no bulk export) and DiveShop360 (no API; manual CSV of four
datasets), and orders the work export-first: the "leave anytime" guarantee must be real before any
importer or marketing claim. The codebase has no export surface at all, and no ZIP capability
exists in the dependency tree. Trust constraints: the bundle must be complete (including
soft-archived history and signed waiver evidence — losing records on migration is the EVE failure
the strategy criticizes), tenant-scoped by the session's shop, and boringly deterministic.

## Decision

- One staff-gated surface: **Settings → Data export** downloads a single ZIP,
  `diveday-export-<shop-slug>-<YYYY-MM-DD>.zip`, dated through the clock seam (`nowDate()`).
- Contents: RFC-4180 CSVs (UTF-8), one per record family — shop profile (with packing list,
  rental catalog, and prices), people (+ roles, including soft-deleted rows with their
  `deleted_at`), certifications, specialty and nitrox certifications, trips (+ per-trip dives,
  site references, predicted conditions), **trip requirements** (the boarding gates), **trip
  assignments** (who crewed each boat), bookings (with payment state), **roll-call events** (the
  append-only head-count ledger — the diver-left-behind audit trail a leaving shop must keep),
  waiver templates (full versioned bodies) and waiver records (signed evidence including the
  attesting staff member and medical answers as JSON — the export is the shop's legal record),
  and rental-fit profiles — plus a `README.txt` manifest stating the export time, shop, row
  counts, column notes, and the deliberate gaps (credentials are never exported). IDs are
  included alongside human-readable names so the files work in a spreadsheet *and* as relational
  data.
- Layering: CSV/bundle assembly is framework-free in `src/lib/export.ts`; per-shop data loading in
  `src/db/export.ts`; the route stays thin and reads the shop from the session, never the URL.
- New runtime dependency **`fflate`** for ZIP writing (`zipSync`/`unzipSync`): zero-dependency,
  ~8 kB, synchronous API, widely used; the unzip side also lets tests round-trip the bundle.
- Access: **owner/manager only** (`canExportShopData` in `src/lib/authz.ts`), the one staff
  feature gated past `isStaff`. Staff surfaces show only *flagged* medical prompts; the bundle
  carries every diver's complete signed medical answers plus the whole roster's contact details,
  so "staff can already see it" does not hold here. Other staff get an explanation on the page
  and a 403 from the route. The privilege is re-checked against the **database** on every request
  (`canPersonExportShopData` in `src/db/export.ts`) — roles live in a stateless JWT that can be
  up to its lifetime stale, and a demoted or disabled manager must lose this surface immediately,
  not at token expiry.

## Alternatives considered

- **Hand-rolled ZIP writer (stored entries)** — ~150 lines of binary-format and CRC32 code to own
  forever; the opposite of boring for a trust-critical surface.
- **archiver / jszip** — heavier, dependency trees or async-stream APIs we don't need.
- **Per-table download links instead of one bundle** — cheaper but breaks the "one button, your
  whole shop" promise the strategy leans on, and loses the manifest.
- **All-staff gating like every other settings surface** — rejected on domain review: the export
  hands over more than any staff surface shows (complete medical answers vs. flagged prompts),
  so it goes to the accountable roles only.

## Consequences

Easy: the documented CSV schemas become the contract the planned importer, scheduled backups, and
read API reuse; tests can unzip and assert the exact bundle. Hard: every schema change now has an
export decision to make — the schema-coverage test in `src/db/export.test.ts` enumerates every
table and fails until a new one is exported, folded into another file, or added to the explicit
exclusion list. Commits us to fflate; escape hatch is swapping the ZIP seam in
`src/lib/export.ts` (one function), cost near zero. Revisit CSV scope when card-image storage
moves beyond URL references, and revisit the owner/manager gate if finer role permissions land.
