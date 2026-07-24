# 20260724-dive-site-media-ingestion — Ingest staff-pasted image URLs, never render them live

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

[The 2026-07-23 codebase review](../../product/assessments/codebase-review-20260723.md) (CR-020)
found that dive-site `satelliteImageUrl`, `routeImageUrl`, and the `imageUrls` gallery accepted
any HTTP(S) URL and rendered it directly on public dive-site/trip pages
(`src/components/DiveBriefingCard.tsx`) — a staff-selected third-party host could observe every
visitor's IP address and referrer on every page view, and could disappear or change without notice.
Course media (`heroImageUrl`, gallery) turned out to already be closed: the course editor was
migrated to file upload only by the CR-011 work (`src/app/shop/[shopSlug]/courses/[slug]/edit/
actions.ts` — "Photos are managed by upload now... No pasted URLs to parse"), so this ticket's
remaining scope is dive-site media only.

## Decision

- **Ingest at save time, not at render time.** `src/lib/storage/ingest-url.ts`'s `ingestImageUrl`
  fetches a staff-pasted URL once, server-side, and re-stores it through the same
  validate/decode/strip-metadata/re-encode/upload pipeline (`storeImage` in `src/lib/storage/
  index.ts`) every direct upload already goes through — reusing CR-012's machinery rather than
  building a second one. `src/lib/storage/ingest-dive-site-media.ts` composes this across all three
  dive-site fields, first checking `resolveDiveSiteImageUrl` so a known bundled-Commons attribution
  photo keeps resolving to its local path without a wasted fetch.
- **SSRF defenses:** http(s) scheme only; DNS-resolve the hostname and reject if *any* resolved
  address is loopback/private/link-local (including the `169.254.169.254` cloud-metadata address)/
  CGNAT/reserved, for both IPv4 and IPv6; `redirect: "manual"` and refuse any 3xx response outright
  rather than following it (the classic bypass for a same-host-validated URL); a 10s fetch timeout;
  a `Content-Length` pre-check plus a streamed read that aborts once the real byte count exceeds the
  cap even when `Content-Length` lied.
- **Known residual gap: DNS rebinding.** The hostname is resolved once before the fetch; a
  DNS-rebinding attacker could in principle serve a public IP to the resolver and switch to a
  private one before Node's own `fetch` connects. Not closed here — doing so needs pinning the
  resolved IP for the actual connection (a custom `dns.lookup`/socket-level override), which is a
  larger, separately-reviewable change. The blast radius is bounded by what follows: the response
  still has to pass content-type/size/magic-byte validation and image decoding
  (`processImage`) before anything is stored, so an internal service has to actually serve
  something that decodes as a small valid image, not just respond at all.
- **Fail closed, always — never fall back to the raw external URL.** If ingestion is blocked,
  rejected, or the storage provider isn't configured, the whole save fails with a friendly error;
  the raw external URL is never persisted as a fallback. This is a deliberate product-behavior
  change: a shop with no `BLOB_READ_WRITE_TOKEN` configured previously could freely paste external
  image links (insecurely); it now cannot use them at all until storage is configured. The ticket's
  own acceptance criteria ("public pages make no arbitrary third-party image requests") makes this
  the correct trade — fail-open would silently reopen the exact gap being closed. The "not
  configured" case is surfaced with its own error code/message
  (`?error=images-unconfigured`, distinct from `?error=images` for a genuinely bad/blocked URL) so
  a shop owner isn't left guessing why a normal-looking link didn't save.
- **Legacy rows are not migrated by this change.** Existing `satelliteImageUrl`/`routeImageUrl`/
  `imageUrls` rows written before this ticket may still hold a raw external URL and will keep
  rendering it live until a shop re-saves that site (which now forces ingestion). A live
  fetch-and-backfill migration needs real Blob storage credentials this environment doesn't have to
  test against safely — deferred as a follow-up, the same way CR-011's ADR deferred direct-upload
  infrastructure it couldn't build and verify in one slice. Bundled Commons-attribution photos are
  unaffected (`resolveDiveSiteImageUrl` already keeps them local, no fetch involved, before and
  after this change).

## Alternatives considered

- **An allowlist of approved third-party hosts, rendered live.** Rejected: still leaks visitor IP/
  referrer to every allowlisted host on every page view, still breaks if that host disappears or
  rate-limits, and an allowlist a shop can't self-serve extend is a support burden. Ingestion closes
  the tracking concern entirely rather than narrowing it.
- **Silently falling back to the raw URL when ingestion fails.** Rejected as directly contradicting
  the ticket's mandate — see "fail closed" above.

## Consequences

- `src/lib/storage/ingest-url.test.ts`, `src/lib/storage/ingest-dive-site-media.test.ts` cover the
  SSRF defenses (private/reserved ranges for both address families, redirect refusal, DNS-failure
  handling), the size bounds (Content-Length pre-check and streamed abort), and the
  not-configured/rejected distinction deterministically, without a real network call.
- A shop without Blob storage configured cannot add a dive-site image via URL until an operator sets
  `BLOB_READ_WRITE_TOKEN` — an accepted, documented trade-off, not a silent regression.
- DNS-rebinding remains a known, documented residual gap; closing it fully is a candidate follow-up.
