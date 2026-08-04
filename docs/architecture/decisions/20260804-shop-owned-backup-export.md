# 20260804-shop-owned-backup-export — Deliver a weekly full-shop backup to storage the shop owns

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Roadmap §1's data-portability wedge promises "switching is safe — your data is yours". The
on-demand export bundle shipped (ADR 20260722-full-shop-export), and the DiveDay-side scheduled
export to `DatabaseBackupBucket` is designed as *platform* disaster recovery
(ADR 20260802-backup-and-restore-posture) — but both copies sit under DiveDay's control. The
missing piece is a copy the shop holds under its own credentials, arriving without anyone
remembering to click download: proof the promise survives DiveDay itself. Constraints: the bundle
carries the whole roster's medical evidence, so the credential and gate are security-sensitive;
per-shop uploads run on a serverless cron with bounded time; and a shop's misconfigured bucket
must never become a retry storm or take the pass down for other shops.

## Decision

A `backup-export` feature module (`src/features/backup-export/`, ADR
20260730-feature-module-contracts) that reuses the tested export seam byte for byte
(`loadShopExportBundleInput` → `buildExportBundle` → `zipExportBundle`, photos included) and adds
the shop-wide `trips.ics` from `calendar-sync` — never a second bundle format to drift.

- **Destination**: one per shop (`shop_backup_destinations`) — S3-compatible endpoint, region,
  bucket, prefix, access key id, and the secret access key **sealed** with `src/lib/secret-box.ts`
  (the `shop_whatsapp_accounts` precedent). No code path returns the plaintext; the opener is not
  exported from the module's `index.ts`. Endpoints are HTTPS-only and refuse
  loopback/link-local/private hosts (SSRF posture — the server makes this request).
- **Upload**: a hand-rolled AWS SigV4 signer over `fetch` (`node:crypto`, PUT only, path-style),
  pinned to AWS's published example signatures in tests. **No new runtime dependency** — the AWS
  SDK's ambient credential resolution (env vars, shared files, IMDS) must never run against a
  *shop's* credential, and the needed surface is one signed request.
- **Cadence and idempotency**: a weekly Vercel cron (`/api/cron/backup-export`, Mondays 04:00 UTC,
  `CRON_SECRET`-gated like retention) delivers to every shop with a destination, at most one
  succeeded scheduled delivery per shop per ISO week (`period_key`), object key deterministic per
  week so retries overwrite. Failures are recorded rows in `shop_backup_deliveries`
  (codes, never sentences — ADR 20260731-domain-layer-copy-leaks) shown on the settings page;
  the next weekly tick is the retry policy.
- **Surface**: `/shop/[shopSlug]/settings/backup` — configure, test-run, disconnect, and read the
  delivery history — gated exactly like the export download (`canPersonExportShopData`,
  re-checked in the database).

## Alternatives considered

- **AWS SDK (`@aws-sdk/client-s3`)** — a large dependency whose default credential/IMDS resolution
  is a liability around tenant credentials; we need one signed PUT.
- **Presigned-URL uploads minted by the shop's own tooling** — pushes a cron and a signer onto
  every shop; the point is that DiveDay does the remembering.
- **Reuse the DiveDay-side `DatabaseBackupBucket` layer with per-shop prefixes** — storage DiveDay
  owns is exactly what this feature exists to not be.
- **Email the bundle weekly** — attachment limits die at real bundle sizes and mailboxes are not
  durable storage.
- **SFTP/WebDAV/rclone-style multi-protocol support** — S3-compatible covers AWS, R2, B2, MinIO,
  Wasabi; more protocols is surface without a shop asking.

## Consequences

Easy: "your data is yours" becomes a standing fact a shop can verify in its own bucket; restores
and vendor-independence stop depending on anyone clicking download; the export seam gains a second
consumer that keeps it honest. Hard/committed: the bundle is built in memory (the fflate seam is
sync), so a very photo-heavy shop pushes the cron's memory/time budget — the escape hatch is
streaming assembly or per-shop fan-out to queued invocations, changing only the module's
internals; the export's known silent-photo-drop gap (see the backup-and-restore runbook) now also
applies to shop-owned copies and is worth fixing at `fetchExportPhotos` for both consumers.
Delivery history is append-only with no prune arm yet — if HD-11 ever sets a window for it, it
joins `src/lib/retention.ts` like every other append-only table. Sealed credentials share
`SECRET_ENCRYPTION_KEY`'s rotation story: rotating the key orphans stored secrets, which surface
as `credential_unreadable` delivery rows until re-entered. Revisit if a real shop needs
non-S3-compatible storage or per-shop schedules; both fit behind the module's `index.ts`.
