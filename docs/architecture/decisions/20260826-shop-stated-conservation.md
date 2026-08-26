# 20260826-shop-stated-conservation — Publish shop-owned conservation notes and commitments

- **Status:** Accepted
- **Date:** 2026-08-26
- **Issue:** [#729](https://github.com/AaronBuxbaum/diveday/issues/729)

## Context

Dive sites need a place for a shop to explain its own conservation practice, and a shop may want
to communicate a small set of repeatable commitments on its public pages. DiveDay cannot verify
those claims and must not turn marketing language into a per-dive operational assertion. The
existing marine-life guide and site briefings also need to remain distinct from what a shop says
about itself.

## Decision

- Store one optional, shop-authored conservation note on each dive site. It is editable with the
  site and is shown in the public dive briefing only when present.
- Store a validated, deduplicated list of stable commitment codes on the shop. The codes are
  localized at render time in English or Spanish and are shown on the public shop chrome.
- Put the explicit disclaimer that commitments are stated by the shop and not verified by DiveDay
  next to the public commitment list. Never imply certification, regulatory compliance, or an
  endorsement from a selected code.
- Keep conservation/park charges separate as a pass-through fee. A fee is a third-party amount
  snapshot into checkout, orders, reporting, and export; it is not evidence that the shop follows
  a conservation practice.
- Do not publish a post-dive conservation recap yet. Executed-dive records now provide the
  operational seam, but a recap still needs a separate product decision and trustworthy evidence
  beyond a shop-level claim.

## Alternatives considered

- **Have DiveDay author or verify each shop's conservation statement** — rejected because the
  platform does not have the field evidence, audit relationship, or jurisdictional authority to
  make that claim.
- **Use free-form tags supplied by each shop** — rejected because translation, moderation, and
  consistent display would drift; the small code registry is intentionally bounded.
- **Attach a conservation claim to every executed dive** — rejected because it would suggest that a
  shop's general policy was performed on that dive and would create a false operational record.
- **Fold a park/conservation fee into shop fare or revenue** — rejected because the shop may collect
  the money for a third party, and the accounting/export distinction must remain visible.

## Consequences

- Shops can explain a site and their general commitments without waiting for a vendor catalog or
  inventing a verification state.
- New commitment codes require localized copy in every supported locale and a review of the
  marketing-claims disclaimer before they are exposed publicly.
- The public claim is deliberately low-assurance. Pilot interviews should confirm that shops can
  maintain it, while legal/privacy review remains the authority for claims, disclosures, and any
  future fee wording.
- An executed-dive record can later support a separate recap decision; this slice does not imply
  that the presence of a record proves a conservation outcome.
