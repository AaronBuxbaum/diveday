# 20260723-upload-transport-limit — An explicit, batched Server Actions body limit

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[The 2026-07-23 codebase review](../../product/assessments/codebase-review-20260723.md) (CR-011)
found that every upload surface — card/specialty capture, course hero and gallery photos, recap
photos — validates and promises a 5 MB image (`MAX_CARD_IMAGE_BYTES` and siblings in
`src/lib/storage/index.ts`, and matching UI copy going back to
[20260718-card-image-storage](20260718-card-image-storage.md)), but every one of them is proxied
through a Next.js Server Action, whose request body Next caps at 1 MB by default. A single 5 MB
photo already exceeds that; the course editor's gallery input (`multiple`, up to eight photos) can
submit several 5 MB files in one request, amplifying the mismatch further.

The ticket's acceptance criteria frame this as a choice: signed direct-to-Blob client upload (which
it prefers for the multi-image case), or an explicit, deliberately bounded server limit. Direct
upload was investigated for the course gallery specifically — `@vercel/blob`'s `handleUpload`/
`upload()` client-token flow (verified against the installed package's own `.d.ts`, not assumed)
does not strictly require the optional `onUploadCompleted` webhook, so it does not obviously need a
publicly reachable callback URL to function. It was set aside for now rather than built:

- **No client-interactive upload component exists anywhere in this app yet.** Every current form is
  a plain `<form action={serverAction}>`; a real direct-to-Blob flow needs a new "use client" upload
  component, a new token-minting API route, and — this is the part that matters — a way to trust the
  resulting blob URL when the client hands it back in the save request. A tampered hidden field could
  otherwise submit an arbitrary URL string into `course.imageUrls`, which the public course page
  renders. Closing that safely means either strict host/pathname validation against the store's own
  domain (Vercel Blob's public hostname is per-store and not a fixed value this app can hardcode
  without extra configuration) or wiring `onUploadCompleted` to authoritatively record the upload
  server-side — which reintroduces the callback-URL question for local dev and this repo's
  Playwright fleet, which only ever talks to `localhost`.
- **CR-011 is a transport-alignment ticket, not a rearchitecture.** Building the first
  client-interactive upload pattern in the app, safely, is a bigger and separately-reviewable slice
  of work than fixing the 1 MB/5 MB mismatch the review actually flagged.
- [20260718-card-image-storage](20260718-card-image-storage.md) already named this exact trade-off
  and deliberately deferred it ("revisit if we need multipart, resumable, or client-side uploads") —
  this ADR is that revisit, and the conclusion is: not yet, but the trigger (the gallery's multi-file
  amplification) is now on record for whoever picks it up next.

## Decision

- **`next.config.ts` sets `experimental.serverActions.bodySizeLimit` to `"16mb"`** — an explicit,
  reasoned ceiling, not the 1 MB default and not an unbounded escape hatch. It is sized for this
  app's actual worst case: the course editor's hero photo (5 MB) plus
  `MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION` new gallery photos (5 MB each) in one submission, plus
  multipart overhead (Next's docs recommend 10–20 KB headroom per upload; 16 MB leaves over 1 MB of
  margin above the 15 MB raw worst case).
- **`MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION = 2`** (`src/lib/storage/limits.ts`) caps how many *new*
  gallery files one course-editor save accepts, enforced both client-side (immediate rejection, no
  round trip) and server-side in `saveCourseContentAction` (authoritative — a tampered client can't
  bypass it). This is what keeps the global body limit from having to absorb an unbounded multi-file
  body (up to eight photos × 5 MB = 40 MB) — the specific amplifying case the review named. It is
  unrelated to `MAX_COURSE_IMAGES = 8` in `src/lib/courses.ts`, which bounds the gallery's total size,
  not one upload; reaching eight photos from empty takes four saves instead of one, which is the
  accepted cost of keeping the transport limit small.
- **This is deliberately conservative for the public surface it also covers.** The same global limit
  applies to every Server Action in the app, including the token-gated (not authenticated) recap
  photo upload (`src/app/recap/[token]/actions.ts`) — the endpoint CR-011's own follow-up, CR-013
  ("Put abuse controls on public write boundaries"), flags as still lacking per-token/IP rate limits.
  16 MB is sized off the *staff* course editor's worst case, not the public recap endpoint's actual
  need (one 5 MB file, ~6 MB would suffice) — capping the gallery batch at 2 rather than 3+ was
  chosen specifically to keep that shared ceiling as low as the multi-file UX can reasonably bear,
  minimizing (not eliminating) the exposure CR-013 is the ticket actually responsible for closing.
- **`src/lib/storage/limits.ts` is new** and holds the constraints (`ALLOWED_IMAGE_CONTENT_TYPES`,
  `MAX_IMAGE_BYTES`, `MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION`) that both server validation
  (`src/lib/storage/index.ts`) and client-side pre-checks need, with no server-only imports — so a
  "use client" component can import it without pulling in code that reads `process.env` for the Blob
  token.
- **`src/components/ImageFileInput.tsx` is a new client component** wrapping every image `<input
  type="file">` in the app (card/specialty capture, course hero/gallery, recap photo). It rejects a
  wrong-type, oversize, or (for the gallery) over-batch file selection immediately — clearing the
  input and showing an inline, specific error (`"<name>: that's over 5 MB — try a smaller photo."` /
  `"Choose up to 2 photos at a time."`) — before any request is sent. The server-side check in
  `storeImage` (`src/lib/storage/index.ts`) and the new per-submission gallery-count check in
  `saveCourseContentAction` are unchanged in authority: the client check is a convenience that saves a
  round trip, never a replacement for it.

## Alternatives considered

- **Signed direct-to-Blob client upload for the course gallery** — the ticket's stated preference for
  the multi-image case; set aside for the reasons in Context above. Recommended follow-up once this
  app has an established, reviewed client-upload pattern to build on, and once the URL-provenance
  question (trust a client-submitted blob URL, or take on the `onUploadCompleted` callback-URL
  question) has an answer that also works under Playwright against `localhost`.
- **One global limit sized only for a single 5 MB file (~6 MB)** — would have been the more
  conservative choice for the public recap endpoint, but forces the course gallery to accept exactly
  one new photo per save. Rejected as worse UX for the case (initial course setup, several photos at
  once) the review specifically flagged as needing a multi-file answer, in favor of the smallest batch
  (2) that still meaningfully helps.
- **No per-submission gallery cap, just a large global limit (e.g. 42 MB for all eight photos at
  once)** — simplest to implement, but widens the public recap endpoint's exposed body size far beyond
  what it needs, with no proportionate benefit; rejected as the shape of amplification CR-011 exists
  to close, not preserve.

## Consequences

- A course editor adding more than two new gallery photos needs multiple saves; existing photos are
  never disturbed by this, only how many *new* ones one submission accepts.
- The public recap endpoint's Server Action body limit is 16 MB, sized for a different form's worst
  case, not its own ~6 MB need — an accepted, documented gap pending CR-013's rate limiting, not a
  silent one.
- `pnpm check:clock`-style enforcement doesn't apply here, but the same "shared constant, not a
  hand-typed number" discipline does: `MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION` and
  `MAX_IMAGE_BYTES`/`ALLOWED_IMAGE_CONTENT_TYPES` are each defined once in
  `src/lib/storage/limits.ts` and read by both the client pre-check and the server's authoritative
  validation, so they cannot drift apart.
