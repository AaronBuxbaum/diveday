# 20260723-certification-expiry-date-only — Certification expiry is a shop-local calendar date

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[The 2026-07-23 codebase review](../../product/archive/codebase-review-20260723.md) (CR-009)
found that certification and specialty-card expiry was captured as a date-only input but persisted
and interpreted as a UTC timestamp fixed at `T23:59:59.999Z`. In a negative UTC offset (e.g.
`America/St_Thomas`, UTC-4) that instant falls hours before the shop's own local day ends, so a
card could read as expired while it was still valid on the shop's wall clock; in a positive offset
the reverse happens. Regex-only validation (`/^\d{4}-\d{2}-\d{2}$/`) also accepted normalized
impossible dates like `2026-02-31`.

## Decision

- **`certifications.expires_at` and `specialty_certifications.expires_at` are `date` columns**
  (`mode: "string"`), not `timestamptz`. There is no time-of-day or timezone component to get
  wrong because none is stored — the value is a calendar date, full stop.
- **A new shared type, `CalendarDate` (`src/lib/calendar-date.ts`)**, is a branded `string` alias
  for the `"YYYY-MM-DD"` shape. It sorts and compares correctly as a plain string (`a < b`) because
  ISO date-only strings sort lexicographically in the same order they sort chronologically — no
  parsing needed for expiry comparisons.
- **`isValidCalendarDate`** rejects a normalized-but-impossible date (`2026-02-31`,
  `2026-04-31`, a non-leap `2025-02-29`) by checking the actual day count for that year/month,
  not just the regex shape. The diver-actions form schema (`dateSchema` in
  `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`) uses it instead of a bare regex.
- **`calendarDateInTimezone(now, timezone)`** converts an instant to the shop's own local calendar
  date (reusing `src/lib/zoned.ts`'s `utcToWallTime`), and every expiry comparison —
  `src/lib/readiness.ts`'s readiness gate, the diver-detail card badges, the CSV export's
  "best card" ranking — compares against that shop-local `todayLocal`, never a raw `Date`. A card
  is valid through the end of its own local day and expires only once the shop's local calendar
  rolls past it, in either UTC-offset direction.
- **`ReadinessInput.timezone` is a required field**, not optional with a default: every caller of
  `calculateReadiness` must consciously supply the shop's timezone (from `shops.timezone`) rather
  than silently falling back to UTC or the server's own clock.
- **Card identifiers are also now case-insensitive**, per this ticket's own acceptance criterion:
  `certifications_shop_agency_identifier_unique`, `specialty_certifications_..._unique`, and
  `nitrox_certifications_..._unique` (`src/db/schema.ts`) now index `lower(identifier)` rather than
  the raw column, mirroring `people_shop_email_unique`
  ([20260723-person-email-uniqueness](20260723-person-email-uniqueness.md)). `createCertification`,
  `createSpecialtyCertification`, and `createNitroxCertification` catch the unique violation and
  return `null` (the existing refuse-on-collision contract, unchanged) instead of throwing; each
  card family's `restore*` conflict check now compares `lower(identifier)` too, so an archived card
  can't be restored out from under a live one that differs only by case.

## Alternatives considered

- **Keep `timestamptz` and always read/write at UTC midnight or noon** — still requires every
  comparison site to know it must convert through the shop's timezone before comparing, and a
  missed conversion fails silently (wrong by hours, not by an error). A `date` column removes the
  failure mode by removing the field that could be misinterpreted.
- **Default `ReadinessInput.timezone` to `"UTC"`** — would have kept every existing call site
  compiling without change, but silently wrong for any shop not on UTC — exactly the bug this
  ticket exists to close. Making it required forces each caller to thread the shop's real
  timezone through.

## Consequences

- Every write path that inserts/updates a certification or specialty-card expiry now passes a
  `"YYYY-MM-DD"` string, not a `Date`; `src/db/seed.ts`'s demo fixtures and `src/db/export.ts`'s
  CSV column follow the same shape.
- Comparing expiry no longer risks a raw `Date <= Date` mistake reading the wrong timezone's
  "today" — the type system requires a `CalendarDate` and a `todayLocal`, not an arbitrary `Date`.
- The migration (`drizzle/20260723194437_certification-expiry-date-only`) casts existing
  `timestamptz` values to `date` with Postgres's own `::date` cast, which truncates to the UTC
  calendar date of the stored instant — acceptable because no production database holds real data
  yet (same reasoning as the person-email-uniqueness migration). **This becomes unsafe the moment a
  shop has live data**: for a negative-offset shop this can silently shift an already-entered
  card's expiry a day earlier or later than what staff intended. Do not replay this migration
  against a populated database without first re-deriving each row's correct shop-local date.
- The companion identifier-case migration
  (`drizzle/20260723200213_certification-identifier-case-insensitive`) will fail to apply if any
  shop already has two live cards for the same agency whose identifiers differ only by case —
  find them first with (repeat per table: `certifications`, `specialty_certifications`,
  `nitrox_certifications`):
  ```sql
  SELECT shop_id, agency, lower(identifier), count(*)
  FROM certifications
  WHERE deleted_at is null
  GROUP BY shop_id, agency, lower(identifier)
  HAVING count(*) > 1;
  ```
  and reconcile each by hand before migrating, same as the person-email-uniqueness migration.
- **Open product question, not resolved by this ticket:** `docs/product/glossary.md`'s own
  **C-card** entry states real certification cards (Open Water through Instructor, and the
  Deep/Wreck/Night/Drysuit specialties) do not expire — only a shop-chosen refresher policy might.
  This ticket hardens `expiresAt` further (a stricter, more correct date comparison) without
  resolving whether the field should even be presented as a card "expiry" versus a shop-set
  "refresher due" date; that policy question predates this ticket and is already open as H-08 in
  [human-decisions.md](../../product/human-decisions.md).
