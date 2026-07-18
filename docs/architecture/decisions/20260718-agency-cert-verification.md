# 20260718-agency-cert-verification — Verify C-cards against the agency behind an assistive seam

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Certification review is manual: staff eyeball a card and click Verify/Reject. Agencies (PADI, SSI,
…) can confirm a cert number, so an automated check would speed the desk and catch bad cards. But
certification gating is safety-critical: an automated integration must never *weaken* the gate, and
there is no live agency integration yet (a per-agency, credential-gated human prerequisite).

## Decision

- **A provider seam, like notifications and storage.** `src/lib/cert-verification/` defines a
  `CertVerificationProvider` with one `verify` method and a `verifyCard` entry point. An HTTP
  gateway provider (`fetch`) POSTs `{agency, level, identifier, holderName}` and reads back a typed
  `verified | not_found | mismatch`. `PADI_*`, `SSI_*`, and `NAUI_*` URL/key pairs route only that
  agency's cards to its authorized gateway; a legacy shared `CERT_VERIFICATION_*` pair is the
  fallback. No complete matching pair → a disabled provider returns `unavailable`.
- **No scraping or reverse-engineering.** Agency-facing card forms, digital-card apps, and Pro
  portals remain human interfaces. The per-agency URL is set only after the agency supplies a
  supported contract, or after an approved server-side broker translates its documented contract.
  The exact setup and contacts live in
  [the agency integration runbook](../../integrations/certification-agencies.md).
- **The check is assistive, and human review stays authoritative.** Applied in
  `verifyCertificationWithAgency`: a **confirmed match** verifies the card and records the source in
  the review note; **not_found / mismatch** only attach a warning note and leave the card
  **pending** (never auto-reject a possibly-valid card); **unavailable** changes nothing. The seam
  fails closed to `unavailable` on any non-ok response, unparseable body, or network error.
- **Human prerequisite (H):** stand up (or contract) an agency-verification gateway and set the two
  env vars. Until then the button reports "not configured" and staff verify manually — unchanged.

## Alternatives considered

- **Auto-reject on not_found** — a flaky or partial agency endpoint would then hide valid cards
  behind a false negative; rejected as unsafe. Not_found warns; a human decides.
- **Per-agency SDKs/clients now** — agencies expose different (often partner-only) APIs; a single
  gateway contract keeps the app decoupled and lets an integration layer normalize per agency.
- **Skip persistence, show a transient result** — loses the audit trail; recording the outcome in
  the review note keeps provenance on the card itself.

## Consequences

- Makes it easy to confirm a card in one click once a gateway exists, and to keep the manual path
  as the always-available fallback and the final authority.
- Commits us to the fail-closed rule: the automated check may promote pending→verified on a
  confirmed match, but only a human ever rejects. New evidence never silently downgrades safety.
- Escape hatch: if we adopt real agency APIs with richer results (e.g. expiry, holder photo), extend
  `CertVerificationResult` and the gateway contract; the review-flow call site is unchanged.
