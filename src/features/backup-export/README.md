# backup-export

A weekly full-shop backup bundle delivered to storage the shop owns — an S3-compatible bucket
(AWS S3, Cloudflare R2, Backblaze B2, MinIO) under the shop's own credentials. The other half of
the "your data is yours" promise: the on-demand export lets a shop leave; this makes sure the
copy exists even if DiveDay disappears.

Decision record: [20260804-shop-owned-backup-export](../../../docs/architecture/decisions/20260804-shop-owned-backup-export.md).
Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).
Operational posture: [backup-and-restore runbook](../../../docs/engineering/backup-and-restore-runbook.md)
(§ *Shop-owned backup destinations*) — this module is the complement to, never a replacement for,
the DiveDay-side S3 export layer described there.

## Owns

- The `shop_backup_destinations` and `shop_backup_deliveries` tables' lifecycles — save,
  disconnect, verify; begin/finish/list deliveries; which shops a weekly run still owes.
- The bundle: the existing full-shop export zip (`src/db/export.ts` → `src/lib/export.ts`,
  photos included) with the shop-wide `trips.ics` calendar document riding along.
- The S3-compatible upload seam — AWS SigV4 request signing over `fetch`, PUT only, no SDK.
- The idempotency rule: one succeeded scheduled delivery per shop per ISO week.
- The failure vocabulary: every refusal and upload failure is a recorded code on a delivery row,
  never a thrown crash and never a sentence (ADR 20260731-domain-layer-copy-leaks).

## Does not own

- The table *definitions*, which live in `src/db/schema.ts` (ADR-0005).
- What the export bundle contains — `src/db/export.ts` / `src/lib/export.ts` stay authoritative;
  this module reuses them byte for byte so the backup is the same tested artifact staff download.
- The iCalendar rendering (`calendar-sync`'s `feedDocument`) or its no-divers invariant.
- The DiveDay-side scheduled export to `DatabaseBackupBucket` (`infra/`), which is disaster
  recovery for the platform; this is vendor-independence for one shop.
- Route wiring (`src/app/api/cron/backup-export/`) and the staff settings UI
  (`src/app/shop/[shopSlug]/settings/export/` — the Backups half of the one data-out surface,
  ADR 20260806-one-data-out-surface), which import this module's `index.ts`.

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
  its own bundle rather than accumulating copies.
- **Failures are rows, not retries.** A failed delivery records its code and waits for the next
  weekly tick (or a manual run); nothing loops against a misconfigured bucket.
- **One shop's failure never blocks another's backup** — the cron isolates per-shop errors.
- **No divers in `trips.ics`** — it is `calendar-sync`'s shop-trips document, which never touches
  bookings; that module's own test asserts it.
- **Time goes through the clock** (`src/lib/clock.ts`), like everything under `src/features`.
