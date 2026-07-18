# 20260718-card-image-storage — Store certification card photos behind a provider seam

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Certification and specialty cards captured a `card_image_url` — a pasted reference, never an
actual upload. Staff want to snap a photo of a diver's C-card at the desk. That needs durable blob
storage, which is a hosting-coupled, credential-gated decision (H-04 / Vercel hosting ADR). The
capture flow must stay testable without real storage, and must never lose the working
paste-a-URL path.

## Decision

- **A provider seam, mirroring the notification seam.** `src/lib/storage/` defines an
  `ImageStorageProvider` with one `upload` method and a single `storeCardImage` entry point that
  validates content-type and size (≤5 MB, image/* only) before touching any provider.
- **Vercel Blob is the provider**, matching the hosting choice — implemented over its documented
  `PUT https://blob.vercel-storage.com/…` API with `fetch` (no SDK dependency), gated on
  `BLOB_READ_WRITE_TOKEN`. Absent the token, a disabled provider returns `not_configured`.
- **The stored value stays a provider-neutral URL** in the existing `card_image_url` columns — no
  schema change. Upload is additive: the capture forms take a file *or* a pasted URL; an uploaded
  photo wins, an unconfigured store silently falls back to the pasted URL, and a bad file
  (wrong type / too big) is a visible error, never a silent skip.
- **Human prerequisite (H):** provision a Vercel Blob store and set `BLOB_READ_WRITE_TOKEN`. Until
  then the seam runs in `not_configured` mode and the pasted-URL path is unchanged.

## Alternatives considered

- **Store bytes in Postgres (bytea/base64)** — bloats the row and the backup, and streams image
  data through the DB connection; rejected for anything but tiny thumbnails.
- **Add `@vercel/blob` SDK now** — a runtime dependency for one PUT call; the fetch implementation
  is smaller and keeps the seam unit-testable with an injected `fetch`. Revisit if we need
  multipart, resumable, or client-side uploads.
- **Direct client→blob signed uploads** — avoids proxying bytes through the server action, but
  needs a token-minting endpoint and more moving parts; defer until image sizes justify it.

## Consequences

- Makes it easy to attach a real card photo, and to swap providers (S3, R2) by adding one
  `ImageStorageProvider` — nothing above the seam changes.
- Commits us to validating uploads at the seam (the single choke point) and to keeping the
  paste-a-URL fallback so an unconfigured or failed store never blocks capturing a card.
- Escape hatch: if we outgrow server-proxied uploads (large files, throughput), move to signed
  client uploads — the `storeCardImage` contract stays, only the provider and the form's target
  change.
