# 20260723-media-validation-and-deletion — Decode, sanitize, and durably delete uploaded media

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[The 2026-07-23 codebase review](../../product/archive/codebase-review-20260723.md) (CR-012)
found two related problems in `src/lib/storage/index.ts` and its callers:

- **`storeImage` trusted the caller-supplied `contentType` string.** Nothing decoded the bytes or
  looked at the actual file signature — a disguised file (any bytes at all, given a `.jpg` name and
  an `image/jpeg` header) would pass validation and reach Vercel Blob unexamined. Dimensions were
  never constrained either, so a small file that decodes into an enormous bitmap (a decompression
  bomb) had nothing stopping it. Uploaded photos also kept whatever EXIF metadata the camera or
  phone wrote — GPS coordinates and device identifiers included — all the way to publication.
- **Deleting a recap photo removed the database row but never the Blob object.** `deleteRecapPhoto`
  (`src/db/recap.ts`) was a bare `DELETE`; nothing called `deleteStoredImage` for the photo's URL.
  Course photo replacement (a new hero upload, a removed gallery photo) had the same gap: the
  superseded URL was simply dropped from `heroImageUrl`/`imageUrls`, and the old blob object was
  never told to go away. Every one of these is a paying-for-nothing orphan, and the ticket also
  flagged that a provider-delete failure had nowhere to surface — the existing `deleteStoredImage`
  swallowed every outcome.

## Decision

### Validation, sanitization, and re-encoding

- **`sharp` (`src/lib/storage/process-image.ts`) decodes every upload before it can be stored.**
  `processImage` is the new authoritative check `storeImage` runs after its existing cheap
  content-type/size gate: it decodes the actual bytes, checks the *real* decoded format against an
  allow-list (`jpeg`/`png`/`webp`/`heif` — `heif` covers HEIC, the format a recent iPhone photo
  arrives in), checks declared width × height against a 40-megapixel ceiling *before* decoding the
  full bitmap (a decompression-bomb guard — image headers store dimensions up front, so this check
  is cheap even for a hostile file), then re-encodes to JPEG. Anything that fails to decode, decodes
  to an unsupported format, or declares too many pixels is rejected — `storeImage` never learns
  the difference between "wrong extension" and "actively malicious," both come back `{status:
  "failed"}`.
- **Re-encoding is what strips metadata**, not a separate step: `sharp` omits EXIF/ICC/GPS data from
  its output unless `withMetadata()` is explicitly called, which nothing here does. `.rotate()` with
  no arguments applies the EXIF orientation tag's visual rotation before that tag is dropped, so a
  photo taken sideways doesn't end up sideways once its metadata is gone.
- **Every accepted format converges to one JPEG output**, regardless of what was uploaded. `sharp`'s
  HEIF encoder isn't compiled into the distributed binary (only decode is; HEIC encoding is
  patent-encumbered and not something this app needs to produce), so there is no HEIC/HEIF *output*
  path to maintain — a real iPhone photo comes in as HEIC and leaves as JPEG. Normalizing PNG/WebP
  input to JPEG too was a deliberate simplification: none of the three upload contexts (certification
  card evidence, course marketing photos, diver recap snapshots) need alpha transparency, so
  preserving PNG's lossless/alpha properties on output would be complexity with no real use.
- **`sharp` is a new runtime dependency**, added to `next.config.ts`'s `serverExternalPackages`
  alongside `@electric-sql/pglite` and `pg` — the same reasoning as those two: it ships a native
  binding that the bundler should not try to inline into the server bundle.

### Deletion lifecycle

- **`media_deletion_attempts` (`src/db/schema.ts`, `src/db/media-deletions.ts`) is a new table**,
  mirroring `payment_operation_intents`' durable-intent shape (CR-005): a row is written and
  committed *before* the provider-delete call (`queueMediaDeletion`), so a crash between "the local
  removal happened" and "the blob is actually gone" leaves a durable record that a delete is still
  owed, not a silent orphan. `queueAndAttemptMediaDeletion` is the common-path helper — queue, then
  attempt immediately, then resolve — used by every caller that removes media a user can see.
- **A provider-delete failure is owner-visible and retryable, never silently swallowed and never
  blocking the local removal.** The row a user sees disappear (a recap photo's row, a course's
  `heroImageUrl`/`imageUrls`) is *always* removed synchronously — the delete queue runs after that
  commit, never gating it. A `failed` row (or a `pending` row stale past five minutes, meaning the
  process died mid-attempt — treated identically for retry purposes) shows up on the shop's Reports
  page (`src/app/shop/[shopSlug]/reports/page.tsx`, same owner/manager gate as the existing stuck-
  payment-operations panel it sits beside) with a one-tap Retry action
  (`src/app/shop/[shopSlug]/reports/actions.ts`).
- **A bounded orphan-cleanup job rides the existing daily cron tick**
  (`src/app/api/cron/reminders/route.ts`, `retryPendingMediaDeletions`), retrying up to 50 stuck
  attempts across every shop per run. This is deliberately reuse, not a new endpoint: the ticket
  wants a bounded, scheduled retry mechanism, and this app already has exactly that shape running
  daily for reminders/recaps with the same `CRON_SECRET` fail-closed gate.
- **`queueMediaDeletion` only queues a URL that could plausibly have been written by this seam's own
  provider** — `isManagedBlobUrl` (`src/lib/storage/index.ts`) checks the URL's hostname against
  Vercel Blob's public-object-URL suffix and rejects anything else, silently (returns `null`, queues
  nothing). This closes a real gap a `security-reviewer` pass on the first version of this ticket
  found: every seeded shop's courses start pre-filled with DiveDay's default template content, whose
  `heroImageUrl`/`imageUrls` are bundled root-relative paths (`/dive-sites/...`,
  `src/db/course-templates.ts`'s `bundledImage()`) — never a Blob object. The original
  `saveCourseContentAction` diffed old vs. new URLs with no such filter, so a shop doing the
  completely ordinary thing (replacing a template's default hero photo with their own) would queue
  the bundled path for provider deletion. That delete could never succeed — Vercel Blob has never
  heard of `/dive-sites/reef.jpg` — producing a `media_deletion_attempts` row stuck `failed` forever,
  permanently occupying a slot on the owner-visible reports panel and the bounded nightly retry, and
  undermining the very "owner-visible and retryable" guarantee this ticket exists to provide (visible,
  yes; ever actually retryable, no). The guard is enforced once, centrally, in `queueMediaDeletion`
  itself rather than at each call site, so no future caller of the deletion queue can reintroduce it.
- **Card evidence photos (`cardImageUrl` on certifications/specialty cards) are deliberately *not*
  wired into this deletion path.** "Deleting" a card is a soft-archive (ADR 20260719-crud-archive-
  semantics) — the row is kept "for safety history" and is restorable via a land-then-undo toast.
  Deleting the underlying blob would break that restore and destroy the safety record the archive
  exists to keep. This ticket's "deleting moderated/removed media" scope is about media whose
  underlying row is genuinely, permanently gone: a hard-deleted recap photo, a superseded course
  photo. A card evidence photo never reaches that state in this app today.
- **The recap-upload race-cleanup path keeps its existing best-effort `deleteStoredImage`, not the
  tracked queue.** When an upload wins the byte-storage race but loses the atomic per-booking-cap
  check in `addRecapPhoto`, no row was ever created — there's nothing for a moderation queue to
  track, and no shopId is cheaply in hand at that point without an extra query. This is upload-side
  cleanup of an object nothing ever referenced, not "deleting moderated/removed media"; the existing
  swallow-everything behavior (documented in place) is intentionally kept narrow to that one case.

## Alternatives considered

- **A pure magic-byte sniff (check the first few bytes against known signatures) instead of a real
  decode** — cheaper, but only catches a file that doesn't even attempt to look like its claimed
  format. A crafted file with a valid JPEG header wrapping something else (or a polyglot) would pass
  a signature check and fail a real decode. `sharp` was already the natural choice for the
  dimension/EXIF/re-encode requirements, so paying for a real decode as the validation step too — one
  library, one pass — was strictly better than a second, weaker check.
- **Resizing an oversized image down instead of rejecting it** — considered for the
  decompression-bomb guard; rejected in favor of a flat reject to match this app's existing "fails
  closed with a specific, actionable error" idiom (`storeImage`'s existing content-type/size checks
  already reject rather than silently coerce) rather than introducing a new "we changed your photo's
  resolution without saying so" behavior.
- **Preserving PNG/WebP output for their alpha channel** — see Decision above; none of this app's
  three upload contexts have a real transparency use case, so normalizing to JPEG uniformly was
  simpler and still correct.
- **A full storage-bucket orphan audit (enumerate every object Vercel Blob holds and cross-reference
  against every `*_image_url` column)** — the more complete reading of "orphan audit," but Vercel
  Blob's list API and the cross-referencing logic needed are a materially larger, separately
  reviewable slice of work than this ticket's actual defect (deletes that are known-attempted but
  unconfirmed). `media_deletion_attempts` closes the orphans this app's own code path can create and
  knows it owes; a blind full-bucket audit is the natural follow-up if ever justified, not something
  this ticket's actual bug required.

## Consequences

- Every upload is now genuinely decoded and re-encoded server-side — including in this repo's
  Playwright fleet, which has no `BLOB_READ_WRITE_TOKEN` configured (`not_configured` provider). A
  real image still passes the pipeline and reaches "stored, but no provider configured"; a disguised
  or malformed file is now rejected at that decode step regardless of provider configuration —
  exercised in `e2e/certifications.spec.ts`.
- A stored image's URL always ends in `.jpg` and its content-type is always `image/jpeg`, regardless
  of what was uploaded — a WebP or HEIC upload's stored filename/extension no longer matches what the
  user picked, which is expected and desired (the stored bytes genuinely are JPEG now).
- `pnpm check:clock` doesn't apply to `media_deletion_attempts`' staleness math directly, but the
  same discipline does: every clock read in `src/db/media-deletions.ts` goes through `nowDate()`
  (`src/lib/clock.ts`), and both cutoff-accepting functions (`listPendingMediaDeletions`,
  `retryPendingMediaDeletions`) take the cutoff as an injectable parameter — mirroring
  `claimBookingsForCheckout`'s `staleBefore` convention (CR-005) — so tests don't depend on real
  wall-clock time passing.
- `media_deletion_attempts` is an internal reconciliation ledger, not a shop record — excluded from
  the full-shop export (`src/db/export.test.ts`), same reasoning as `payment_operation_intents`.
