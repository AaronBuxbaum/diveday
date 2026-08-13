# FU-20260813-drop-field-guide-text-columns — Finish the expand/contract: drop the five dead text columns on `dive_site_creatures`

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/marine-catalog-spanish-copy-0431m5`, the change that made
  the field guide DiveDay's copy (ADR 20260813-marine-life-is-diveday-copy)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/db/schema.ts`, `drizzle/`, `src/db/export.ts`

## What I noticed

A `dive_site_creatures` row is now a `catalog_slug` and a `position`. Five columns on it —
`name`, `kind`, `image_url`, `description`, `preparation_tip` — are written by nothing and read by
nothing. They still hold the words shops and the seed wrote before 2026-08-13.

`name` and `kind` had their `NOT NULL` dropped in that release's migration
(`drizzle/20260813191826_curly_speed/`) purely so the new insert, which supplies neither, would
work. That is half of an expand/contract with no ticket behind the other half, which is the shape
that quietly becomes permanent.

## Why it isn't already done

Not safe in the same release, and the guard is right to say so. `pnpm db:migrate` runs **inside**
the Vercel production build while the *previous* deployment is still serving
(ADR 20260806-destructive-migration-guard), and that deployment selects all five columns — the old
`listDiveSiteCreatures` reads `select()` over the whole row and renders `name` on a public briefing.
Dropping them at the same moment the new code ships breaks the release that is still up. There are
no down migrations, so the only way back would be a forward fix or a Neon branch.

The wait is one release, not a review: once a build carrying ADR 20260813-marine-life-is-diveday-copy
is the live deployment, nothing anywhere selects those columns.

## Proposed change

One migration dropping the five columns, with the acknowledgement the guard requires on each — the
reason genuinely is "no instance has read this since <the release that shipped the ADR>", which is
the sentence the marker exists for:

```sql
-- diveday:allow-destructive drop-column dive_site_creatures.name: field guide is a slug since ADR 20260813-marine-life-is-diveday-copy; no live release reads it
ALTER TABLE "dive_site_creatures" DROP COLUMN "name";
```

Delete the five columns from `diveSiteCreatures` in `src/db/schema.ts` (the block already marks them
`Legacy:` and points here) and regenerate. Nothing else needs to change: the CSV export already
resolves its word columns from the bundle rather than from the row, and no test asserts on them.

**Not proposed:** dropping `catalog_slug`'s nullability at the same time. It is nullable because
rows a shop typed by hand before the ADR could have no slug, and those rows are still there —
skipped by every reader, but their own cleanup decision (whether to delete them, and whether to tell
the shop) rather than a column change.

## Prompt

```text
In the DiveDay repo, finish the expand/contract left by ADR
docs/architecture/decisions/20260813-marine-life-is-diveday-copy.md.

First verify the precondition: a deployment containing that ADR's code must already be live. If the
release that introduced it has not shipped, stop and say so -- dropping these columns while the
previous release still serves them breaks production, which is exactly why this was deferred.

Read: docs/architecture/decisions/20260806-destructive-migration-guard.md (the acknowledgement
grammar, and why this is refused without one), the `diveSiteCreatures` block in src/db/schema.ts
(the five columns are marked `Legacy:`), and scripts/check-migrations.mjs.

Do this: delete `name`, `kind`, `imageUrl`, `description` and `preparationTip` from
`diveSiteCreatures` in src/db/schema.ts, run `pnpm db:generate`, and add a
`-- diveday:allow-destructive drop-column dive_site_creatures.<column>: <why>` line to the generated
SQL for each -- one marker per column; the guard refuses a marker that excuses nothing and one that
blankets a file. Leave `catalog_slug` nullable.

Confirm by grep that nothing in src/ reads those five fields before you drop them.

Done when `pnpm check` is green and `pnpm test src/db/export.test.ts` passes. Delete
docs/product/follow-ups/FU-20260813-drop-field-guide-text-columns.md as part of the change.
```
