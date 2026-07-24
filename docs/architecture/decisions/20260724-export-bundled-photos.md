# 20260724-export-bundled-photos — Bundle DiveDay-stored photos as files in the export ZIP

- **Status:** Accepted
- **Date:** 2026-07-24
- **Supersedes (in part):** [20260722-full-shop-export](20260722-full-shop-export.md)'s exclusion of
  image binaries, and its own "Consequences" note that this was the deferred next step ("revisit CSV
  scope when card-image storage moves beyond URL references").

## Context

The full-shop export ships every certification/specialty card image, recap photo, and dive-site/
course image as a `*_image_url` string in its CSV — a durable Vercel Blob URL, but a URL that only
resolves "while the shop's DiveDay account is active" (the bundle's own README says so). A shop that
closes its account, or whose blob store is deleted, loses those photos entirely even though it kept
the export. The product owner asked for a more complete export; this is the concrete gap the original
export ADR already flagged as the next thing to revisit. Dataset sizes here are small (a single dive
shop's roster and photo library), so fetching every photo synchronously at download time is
practical — no background job or async delivery is needed.

## Decision

- `loadShopExportBundleInput` (`src/db/export.ts`) collects every `*_image_url` /
  `image_urls[]` value referenced anywhere in the bundle's rows into a deduped, sorted
  `photoUrls: string[]` on `ExportBundleInput`.
- The download route (`src/app/shop/[shopSlug]/settings/export/download/route.ts`) calls the new
  `fetchExportPhotos` (`src/lib/export.ts`) after the CSVs are built, and zips each fetched photo
  into the bundle at `photos${new URL(url).pathname}` — the same path segment the URL already
  carries (`cards/`, `recap/`, `dive-sites/`, `courses/`), so a reader can always find a CSV's
  `image_url` at the matching `photos/...` path with no lookup table.
- **Only `isManagedBlobUrl` URLs are ever fetched** (`src/lib/storage/index.ts`'s existing check for
  DiveDay's own `*.public.blob.vercel-storage.com` objects) — never an external link a shop pasted
  before uploads existed, and never a bundled template asset path like `/dive-sites/default.jpg`.
  This keeps the export from ever making a live request to a host outside DiveDay's own storage, the
  same constraint `src/lib/storage/ingest-url.ts` already enforces for staff-pasted URLs.
- **Best-effort, never fatal.** A single photo that fails to fetch (timeout, 404, deleted object) is
  silently absent from `photos/`; the export otherwise completes. The CSV's own `image_url` column is
  unchanged either way — it remains the fallback if the account is still active when the file is
  read.
- `ExportFile.content` widens from `string` to `string | Uint8Array` so `zipExportBundle` can carry
  binary entries alongside the CSV/README text entries; `buildExportBundle` and the CSV writers are
  otherwise untouched.
- README copy is updated to describe the `photos/` folder and to soften the old blanket "image
  binaries of any kind... never as files" exclusion to the narrower true gap: a link the CSV carries
  that was never stored through DiveDay.

## Alternatives considered

- **Fetch and embed everything the CSV references, including non-managed URLs** — rejected: fetching
  a shop-pasted external URL from the server on every export is the SSRF surface `ingestImageUrl`
  already exists to avoid; a shop's export must never become a vector for hitting arbitrary hosts.
- **A separate downloadable photo archive, not part of the CSV bundle** — rejected: splits "your whole
  shop, one button" into two downloads and two consistency stories, the same reasoning the original
  export ADR used to reject per-table download links.
- **Background job that emails a photo bundle later** — rejected as unnecessary complexity for the
  actual (small) data volumes here; synchronous fetch-and-zip keeps the one-click download intact.

## Consequences

Easy: leaving DiveDay now genuinely keeps everything, including the photos, closing the gap the
original export ADR named as deferred. Hard: export download latency now scales with photo count and
size (bounded by the existing per-image 5 MB cap and a 10 s per-photo fetch timeout); a shop with an
unusually large photo library would see a slower download, with no progress indicator today — revisit
with a background/streaming delivery if that ever becomes a real complaint. The route now makes
outbound HTTP calls during a request instead of being pure DB-to-response; that seam is isolated to
`fetchExportPhotos` and easy to swap for the storage provider's own bulk-export API if Vercel Blob
adds one.
