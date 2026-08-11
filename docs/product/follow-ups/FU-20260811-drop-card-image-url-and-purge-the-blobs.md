# FU-20260811-drop-card-image-url-and-purge-the-blobs — Finish retiring card photos: drop the two columns and delete the stored objects

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/trip-pages-ui-cleanup-44l54k`, which removed the last UI
  that displayed a card photo (ADR 20260811-retire-the-digital-card)
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/db/schema.ts`, `src/db/anonymize.ts`, `src/db/export.ts`, `src/db/media-deletions.ts`,
  `drizzle/`, `docs/architecture/decisions/20260811-retire-the-digital-card.md`

## What I noticed

`certifications.card_image_url` and `specialty_certifications.card_image_url` are now write-dead
*and* read-dead in the product. The upload went in ADR 20260804-card-evidence-is-the-number; the
two remaining displays (the `DigitalCardFlip` digital card, and the specialty row's "View card
photo" link) went in ADR 20260811-retire-the-digital-card, which also removed `cardImageUrl` from
`createCertification` / `createSpecialtyCertification`.

What is left is real data with no reader. For any shop that captured photos before 2026-08-04,
rows still hold a `https://….public.blob.vercel-storage.com/…` URL, and the objects behind those
URLs are still sitting in Vercel Blob. Nothing in the app will ever show them again. They are
reached only by two paths:

- **Diver erasure** — `src/db/anonymize.ts` retires each URL through the media-deletion ledger
  (`retire("certification_card", card.cardImageUrl)`) and nulls the column. So a diver who asks to
  be erased does get their photo deleted.
- **CSV export** — `src/db/export.ts` emits the `card_image_url` column and counts the URLs into
  the bundle's `photos/` manifest, so a shop taking its data out still gets them.

A shop that never erases anybody keeps paying to store photographs of their divers' plastic
indefinitely, for a feature that no longer exists. That is a privacy posture nobody chose — it is
the residue of two removals that were each individually correct to stop short of a migration.

## Why it isn't already done

Three reasons, all of which deserve a deliberate change rather than a rider on a UI-cleanup PR:

1. **It is a destructive migration.** `pnpm check:migrations`
   (ADR 20260806-destructive-migration-guard) refuses a `DROP COLUMN` in a migration newer than the
   previous release unless the SQL carries a `-- diveday:allow-destructive` line naming the rule,
   the table, the column, and why. Migrations apply during the production build while the previous
   release is still serving, and there are no down migrations — so the column has to be provably
   unread by the *currently deployed* code, not just by `main`.
2. **The blobs must be purged before the pointers are.** Dropping the column first strands every
   object in Vercel Blob with nothing left in the database pointing at it — unrecoverable, and
   undetectable. The delete has to go through the existing media-deletion ledger with its retry
   semantics, not a one-shot script, because a provider delete that fails needs to be retried and
   surfaced (that is what the "stuck media deletions" panel in Settings is for).
3. **It changes the export contract.** `card_image_url` is a documented CSV column. Removing it
   changes the shape of a file shops may have tooling around, and the import side has to keep
   tolerating it in an older bundle.

## Proposed change

Three commits, in this order — the ordering is the whole point:

1. **Purge, using the ledger.** Add a one-off migration-style job (or a bounded pass in the
   existing weekly `src/app/api/cron/retention/` run) that, for every non-null
   `certifications.card_image_url` / `specialty_certifications.card_image_url` where
   `isManagedBlobUrl(url)` is true, enqueues a `certification_card` media deletion and nulls the
   column. Reuse `retire()`'s call site in `src/db/anonymize.ts` as the model — including its
   `isManagedBlobUrl` guard, which is what keeps a bundled asset or a legacy pasted external URL
   from being queued for a provider that has never heard of it (CR-012). Do **not** write a script
   that calls the blob provider directly.
2. **Wait for the ledger to drain.** The Settings "Data & integrations" panel lists stuck media
   deletions; this step is done when that list is empty and every enqueued row is discharged.
   Include this as an explicit gate in the PR description, not an assumption.
3. **Drop the columns**, with `-- diveday:allow-destructive drop-column certifications.card_image_url: …`
   and the matching line for `specialty_certifications`, and remove the export column plus the two
   `anonymize.ts` retirement calls. Keep the import side tolerant of an older bundle that still has
   the column (ignore it rather than refusing the file).

What I am **not** proposing: deleting the blobs and leaving the columns, which reproduces the
stranded-pointer problem in the other direction (rows pointing at 404s that erasure will then try,
and fail, to delete forever).

## Prompt

```text
Finish retiring certification card photos in the DiveDay repo: purge the stored blobs, then drop
the two now-dead columns.

Read first, in this order:
- docs/product/follow-ups/FU-20260811-drop-card-image-url-and-purge-the-blobs.md (this file — the
  full reasoning, including why the ordering matters)
- docs/architecture/decisions/20260811-retire-the-digital-card.md and
  docs/architecture/decisions/20260804-card-evidence-is-the-number.md
- docs/architecture/decisions/20260806-destructive-migration-guard.md and
  scripts/check-migrations.mjs
- src/db/anonymize.ts (the `retire()` helper and its two card call sites), src/db/media-deletions.ts,
  src/db/export.ts, src/db/import.ts, src/lib/storage/blob-host.ts

The constraint that makes this non-obvious: migrations run during the production build while the
PREVIOUS release is still serving, and there are no down migrations. So the blobs must be purged
through the media-deletion ledger, and the ledger must be drained, BEFORE the columns are dropped —
dropping first strands every stored object with nothing pointing at it. Do not call the blob
provider directly from a script; go through the ledger so failures retry and surface in Settings'
stuck-media-deletions panel.

Done means:
- A bounded, resumable purge pass enqueues a `certification_card` media deletion for every non-null
  `certifications.card_image_url` / `specialty_certifications.card_image_url` that passes
  `isManagedBlobUrl`, and nulls the column. Covered by a test that asserts a non-managed URL is
  nulled but NOT enqueued.
- A follow-up migration drops both columns, each carrying a
  `-- diveday:allow-destructive <rule> <table>.card_image_url: <why>` line.
- src/db/export.ts stops emitting the column; src/db/import.ts still accepts (and ignores) an older
  bundle that has it, with a test.
- The two `retire("certification_card", …)` calls leave src/db/anonymize.ts, and its tests still
  prove recap photos and waiver documents are retired.
- src/db/schema.ts's "Legacy only" comments on both columns are gone with the columns.
- Delete docs/product/follow-ups/FU-20260811-drop-card-image-url-and-purge-the-blobs.md.

Checks: pnpm check (which includes check:migrations), pnpm test src/db/anonymize --reporter=dot,
pnpm test src/db/export --reporter=dot, pnpm test src/db/import --reporter=dot. Ship the purge and
the drop as separate commits in the PR, and say in the PR description that the drop must not merge
until the ledger has drained in production.
```
