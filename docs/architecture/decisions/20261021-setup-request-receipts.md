# 20261021-setup-request-receipts — Bound requester receipts to saved setup requests

- **Status:** Accepted
- **Date:** 2026-10-21
- **Amends:** [20261007-setup-request-form](20261007-setup-request-form.md)

## Context

[Issue #2866](https://github.com/AaronBuxbaum/diveday/issues/2866) adds a receipt a requester can
find after closing the thank-you page. A public form accepts unverified addresses and arbitrary
shop names. Its operator alert carries personal details and a founder-only setup capability;
none belongs in a requester receipt.

## Decision

- Send a separate `setup_request_receipt` with fixed English or Spanish copy, chosen from the
  saved request's locale. The renderer takes only locale. The sender is DiveDay, replies go to
  `SUPPORT_EMAIL`, and no submitted text, operator inbox or setup link reaches the envelope.
- The public action explicitly stores `receipt_status = pending`. Historical/null rows are
  ineligible. A plain server-only helper takes only the saved ID; no resend or lookup endpoint
  is added. Operator notification and receipt are separate `after()` tasks.
- A short global PostgreSQL advisory transaction lock protects both an exact trimmed, lowercased
  address's 24-hour cooldown and a limit of 30 admitted claims per rolling hour. All admitted
  claims spend the budget regardless of outcome. Suppressed submissions keep their request rows
  but no claim timestamp; aliases remain distinct. Commit the claim before contacting SES and
  re-read the retained address and locale immediately before constructing the envelope.
- Store four nullable request-row columns: status (`pending`, `claimed`, `accepted`, `failed`,
  `unknown`, `suppressed`), claim time, accepted SES MessageId, and an allowlisted error code.
  Receipt transport passes `maxAttempts: 1` to the existing SES adapter; other callers retain
  SDK defaults. No application retries, queue, recovery cron or request correlation tags.
- Log only request ID, state and fixed codes. The existing signed SES webhook logs outcomes
  by MessageId, including unknown messages. Keep SES bounce/complaint suppression intact.

## Alternatives considered

- **Reuse the operator alert** — exposes capabilities and turns arbitrary submitted text into branded mail.
- **Automatic retries and delivery timeline** — add persistence and duplicate-delivery risk beyond this receipt's need.
- **Only in-memory suppression** — cannot hold address/global limits across instances.

## Consequences

A receipt is best-effort, not guaranteed delivery. A crash before the callback/claim can lose it;
a crash after claim or acceptance before bookkeeping leaves unresolved state. Nothing retries
those rows. SES acceptance does not prove delivery. Erasure before the final read cancels mail;
erasure after provider handoff cannot recall it. The saved request remains available for manual
onboarding when receipt delivery fails.

Metadata shares the request's 365-day retention, manual erasure and exclusion from shop exports.
Revisit only if observed support needs justify stronger recovery; that requires a separately
reviewed retry policy and migration, rather than resetting terminal claims by hand.
