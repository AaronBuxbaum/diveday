# 20260721-manual-certification — Certify C-cards by manual staff lookup, not an agency integration

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

[20260718-agency-cert-verification](20260718-agency-cert-verification.md) added an assistive provider
seam (`src/lib/cert-verification/`) that POSTed a C-card to its issuing agency's gateway and, on a
confirmed match, promoted the card pending→verified. That seam never had a real gateway to call: PADI,
SSI, and NAUI expose no usable public C-card verification API, and standing one up was a per-agency,
credential-gated human prerequisite ([H-10](../../product/human-decisions.md)) that never
resolved. So the seam always fell through to its disabled provider and staff verified every card by
hand anyway — the automated path was carrying configuration, docs, env vars, and a UI button for a
capability that did not exist.

Certification gating is safety-critical, so the machinery still had to be reasoned about and tested
even though it never fired. The cost was real; the benefit was hypothetical.

## Decision

- **Remove the automated agency-verification seam.** Delete `src/lib/cert-verification/`,
  `verifyCertificationWithAgency`, the "Check agency" staff action/button, the `agency-*` result
  notices, the `*_CERT_VERIFICATION_*` env vars, and the agency-integration runbook.
- **Certification stays a manual, staff-driven step.** The capture→verify workflow is unchanged: a
  card is recorded pending, and a card only affects readiness once staff mark it certified. What
  changes is that certifying is explicitly a *manual lookup*: staff confirm the card number with the
  issuing agency (in the agency's own portal, outside DiveDay) and click **Mark certified**. Staff
  copy says exactly this.
- **The agency stays as recorded data.** The `certification_agency` enum and the `agency` column on
  `certifications` / `specialty_certifications` / `nitrox_certifications` remain — they record which
  agency issued a card, and appear on the diver's card list. Only the *automated verification against*
  that agency is gone.
- **"Certified" is the user-facing word.** The stored status value is still `verified` (what the
  readiness engine reads); the staff surface labels that state "certified" and the action "Mark
  certified", so the button and the badge agree.

## Alternatives considered

- **Keep the disabled seam for a future integration.** Rejected: it is speculative plumbing for an
  API that does not exist, and safety-critical code that never runs is a liability, not an option
  value. If a real agency API appears, a new seam can be added deliberately then.
- **Drop the `agency` column too.** Rejected here (a schema migration on a safety-critical table for
  no readiness benefit): the agency is still useful evidence for a human confirming a card, so it
  stays as plain data.
- **Auto-certify on some heuristic (name/number format).** Rejected as unsafe: nothing but a human
  confirming the card against the agency may clear the gate.

## Consequences

- Less code and configuration on a safety surface; the always-available manual path is now the only
  path, and staff copy tells them to look the number up before clicking Mark certified.
- No behavioural change to readiness: the same verified/unexpired evidence clears the same gates.
- If DiveDay later integrates a real agency API, it returns as a new, deliberately-scoped decision —
  not resurrected speculative plumbing.
