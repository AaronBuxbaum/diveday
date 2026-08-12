# backup-export

One full-shop backup bundle, and the two places it is allowed to go.

- **To the shop** — an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO) under the
  shop's own credentials, weekly. The other half of the "your data is yours" promise: the on-demand
  export lets a shop leave; this makes sure the copy exists even if DiveDay disappears.
- **To DiveDay** — the private, versioned `DatabaseBackupBucket`, weekly, under one write-only
  uploader credential. Disaster recovery for the platform, and the runbook's §2 layer.

Same bundle, different readers. Neither substitutes for the other: the shop-owned copy covers only
shops that configured a destination and is under credentials DiveDay cannot use, and the
DiveDay-side copy is not something a shop can be handed.

Decision records: [20260804-shop-owned-backup-export](../../../docs/architecture/decisions/20260804-shop-owned-backup-export.md)
and [20260812-platform-backup-runner](../../../docs/architecture/decisions/20260812-platform-backup-runner.md).
Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).
Operational posture: [backup-and-restore runbook](../../../docs/engineering/backup-and-restore-runbook.md)
(§2 and §2b).

## Owns

- The `shop_backup_destinations` and `shop_backup_deliveries` tables' lifecycles — save,
  disconnect, verify; begin/finish/list deliveries; which shops a weekly run still owes.
- The bundle: the existing full-shop export zip (`src/db/export.ts` → `src/lib/export.ts`,
  photos included) with the shop-wide `trips.ics` calendar document riding along. Assembled once
  in `bundle.ts` and shared by both runners, so the two copies of a shop's data are the same
  artifact and the runbook's restore procedure is correct for whichever one is at hand.
- The S3-compatible upload seam — AWS SigV4 request signing over `fetch`, PUT only, no SDK.
  Path-style addressing for portability (R2, B2, MinIO); virtual-hosted for AWS S3 itself.
- **Both destinations a bundle may go to**, and nothing else: the shop's own bucket
  (`run-backup.ts`) and DiveDay's `DatabaseBackupBucket` (`platform-backup.ts`, the runbook's §2
  scheduled logical export). These are siblings, not variants — different credentials, different
  failure records, different reader. See the table at the top of `platform-backup.ts`.
- The idempotency rule: one succeeded scheduled delivery per shop per ISO week.
- The failure vocabulary: every refusal and upload failure is a recorded code on a delivery row,
  never a thrown crash and never a sentence (ADR 20260731-domain-layer-copy-leaks).

## Does not own

- The table *definitions*, which live in `src/db/schema.ts` (ADR-0005).
- What the export bundle contains — `src/db/export.ts` / `src/lib/export.ts` stay authoritative;
  this module reuses them byte for byte so the backup is the same tested artifact staff download.
- The iCalendar rendering (`calendar-sync`'s `feedDocument`) or its no-divers invariant.
- Route wiring (`src/app/api/cron/backup-export/`, `src/app/api/cron/platform-backup/`) and the
  staff settings UI (`src/app/shop/[shopSlug]/settings/export/` — the Backups half of the one
  data-out surface, ADR 20260806-one-data-out-surface), which import this module's `index.ts`.
- The bucket, its lifecycle rules, the write-only uploader IAM user, and the freshness watchdog
  that reads the bucket back — all `infra/lib/infra-stack.ts` (§11 and §19). This module can
  write a bundle; it deliberately cannot see one, because the uploader credential has no
  `ListBucket`.

## Public surface

Everything importable from outside is re-exported by `./index.ts`. Deep imports are a
`pnpm check:architecture` failure. Deliberately **not** exported: anything that returns a
plaintext secret access key — the credential is sealed on the way in (`src/lib/secret-box.ts`)
and opened only inside `run-backup.ts`, at the moment of a signed upload.

## May import

`@/lib/**`, `@/db/**`, and other feature modules' `index.ts` (it uses `calendar-sync`'s).
Never `@/app/**`.

## Invariants

- **The secret access key never leaves the module.** No exported function returns it, the
  settings UI never receives it back, and no log line or delivery row carries it. Rotating a
  credential is the same gesture as connecting one.
- **Destinations are HTTPS, non-private hosts only.** The server is the party making this
  request, so a destination pointing at a loopback/link-local/private address is refused with a
  code before a row is ever written.
- **Idempotent per shop per ISO week.** A re-invoked cron skips shops with a succeeded scheduled
  delivery for the period; the object key is deterministic for the period, so a retry overwrites
  its own bundle rather than accumulating copies. The platform runner has no ledger to skip
  against — it cannot read its own bucket — so it relies on the deterministic key alone: a re-run
  redoes the work and overwrites, which on a versioned bucket is additive, not destructive.
- **The platform uploader is write-only, and nothing here pretends otherwise.** No function in
  this module lists, reads, or deletes from `DatabaseBackupBucket`. Whether a bundle actually
  landed is answered by a different principal entirely (the watchdog in `infra/`), which is what
  keeps a leaked uploader key from being able to read a shop's exported waivers back out.
- **Failures are rows, not retries.** A failed delivery records its code and waits for the next
  weekly tick (or a manual run); nothing loops against a misconfigured bucket.
- **One shop's failure never blocks another's backup** — the cron isolates per-shop errors.
- **No divers in `trips.ics`** — it is `calendar-sync`'s shop-trips document, which never touches
  bookings; that module's own test asserts it.
- **Time goes through the clock** (`src/lib/clock.ts`), like everything under `src/features`.
