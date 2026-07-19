# 20260719-card-photo-only — Capture certification evidence as an upload only

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

The staff certification forms exposed both a photo upload and a free-form card-image URL. The URL
path makes the capture decision look more complicated than it is and leaves staff choosing between
two evidence sources. The deployed product already has its Blob upload seam.

## Decision

Supersedes 20260718-card-image-storage's form-level URL fallback. Certification and specialty-card
forms show only the existing photo-upload control (JPG, PNG, or WebP, up to 5 MB). The provider
seam and provider-neutral `card_image_url` storage remain unchanged; local environments without a
configured store can still capture the card details without fabricating a URL.

## Alternatives considered

- **Keep the pasted URL as an advanced option** — rejected because the second field adds visual and
  operational complexity without improving the normal desk workflow.
- **Require a photo before any card can be captured** — deferred; shops may need to record a card
  while storage is unavailable and leave it pending for follow-up.

## Consequences


The common path is one clear photo upload, and no user-provided external URL is stored. A missing
photo remains visible as absent evidence and cannot strengthen readiness on its own. Revisit if
shops need a controlled import adapter for a trusted card-image system; it should be a provider,
not a free-form form field.
