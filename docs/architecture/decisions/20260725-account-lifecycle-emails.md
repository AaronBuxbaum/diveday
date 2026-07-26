# 20260725-account-lifecycle-emails — Hashed, expiring DB tokens for verify/reset; account emails stay outside notification_deliveries

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

ADR-0006 accepted password reset/verification as deferred ("ours to build when shops onboard").
The `/onboard` self-serve flow ([20260718](20260718-demo-mode.md) predates it, but shops have
been signing themselves up for a while with no welcome email, no way to confirm the address they
typed is real, and no way back in if they forget their password — email support is the only
recourse today. Meanwhile `docs/engineering/resend-email-runbook.md` and
[20260726-hosted-mailboxes-for-platform-mail](20260726-hosted-mailboxes-for-platform-mail.md)
settled that Resend stays the sender for mail DiveDay's app sends, regardless of what handles
DiveDay's own inbound correspondence — so these are ordinary transactional sends, same as a
booking confirmation.

Two existing token shapes were available to crib from (`docs/engineering/
capability-telemetry-runbook.md`): the hashed, expiring, revocable DB row (`waiver_records`,
`booking_capabilities`), and the stateless HMAC-signed link (`recap-links.ts`). The runbook
already flags the stateless shape as the weaker one — no per-token revocation, only a shop-wide
secret rotation. A password-reset link is a bearer credential over account takeover; it needs the
strong shape.

## Decision

**A new `account_tokens` table**, shaped like `waiver_records`/`booking_capabilities`: a
`purpose` enum (`email_verification`, `password_reset`), a SHA-256 `token_hash` (the raw token
is never stored), `expires_at`, and `used_at`/`superseded_at` for one-time use. Issuing a fresh
token for the same account+purpose supersedes any prior outstanding one (mirrors
`issueWaiverRequest`). `email_verification` gets a 3-day TTL (low stakes, just confirming an
address); `password_reset` gets 1 hour (an active credential over the account, matched to
industry norms). `user_accounts` gains a nullable `email_verified_at`.

**Verification does not gate sign-in.** Enforcing it would lock out every seeded/demo/existing
account with no migration path in this change. It's tracked and shown; whether to require it is
a separate, later decision once there's a resend/support path for a stuck account.

**Password-reset request never confirms whether an email is registered** — same shape as the
rate-limit message's existing "never reveal which dimension tripped" rule (CR-013): the request
action always redirects to the same generic "if that's your email, check your inbox" notice, and
only actually issues a token when an active account matches.

**Four new `notify()` kinds — `welcome`, `email_verification`, `password_reset_request`,
`password_changed` — added only to the Zod discriminated union in `src/lib/notifications/
index.ts`, not to the `notification_kind` Postgres enum or `notification_deliveries`/
`notification_delivery_attempts`.** Those tables are booking-scoped (`booking_id` `NOT NULL`);
these sends are account-scoped and structurally excluded from `TrackedNotification` the same way
`waitlist_invite` already is today (no `booking_id` field) — not tracked on the shop's delivery-
issues dashboard, dispatched through `notify()` exactly like every other kind. Idempotency keys
use the new token row's own id (`email-verification/<tokenId>`, `password-reset-request/
<tokenId>`) rather than the raw token, so a retried send never double-delivers without the
Resend Idempotency-Key ever carrying the bearer secret itself.

**Three new bearer-token routes**, following the existing top-level pattern (`/waivers/[token]`,
`/ready/[token]`): `/verify/[token]`, `/forgot-password` (a plain form, no token), and
`/reset-password/[token]`. All three added to `CAPABILITY_ROUTE_PREFIXES` in
`src/app/observability.ts` and to the capability-telemetry runbook's table. Consistent with
`/ready/[token]`, neither `/verify/[token]` nor `/reset-password/[token]` mutates on the bare GET
— each renders a confirm button/form that a server action then re-verifies and consumes
atomically, so a corporate link-prescanner's GET prefetch can't burn a one-time token before the
person clicks it.

**New rate limits** (`src/lib/rate-limit.ts`): `passwordResetRequestByIp` and
`passwordResetRequestByEmail` (same two-net shape as sign-in), and `accountTokenAction` for the
verify-confirm/reset-submit actions — a narrower ceiling than `capabilityAction`'s boat-WiFi-
sized allowance, since an account token is one person's, never a shared dock connection's.

`welcome` and `email_verification` are sent together right after `/onboard` creates the account;
`password_changed` is sent after a successful reset, so an account owner who didn't request it
has a signal.

## Alternatives considered

- **Reuse `recap-links.ts`'s stateless HMAC token** — no dependency, but no individual
  revocation and no one-time-use; wrong shape for a password-reset credential.
- **Gate sign-in on verification immediately** — the more common SaaS pattern, but breaks every
  seeded/demo/existing account with nothing in this change to unstick them.
- **Fold `welcome` and `email_verification` into one email** — simpler, but conflates "here's
  what DiveDay is" with "prove you own this address," and the user asked for them as distinct
  standard emails.

## Consequences

Shops get a real welcome/verify/reset loop instead of "email support." Verification is tracked
but not enforced — a shop can run indefinitely unverified today; revisit if abuse or support load
ever makes that untenable, at which point the migration is a single `NOT NULL`-style gate in
`verifyCredentials` plus a resend-link affordance, not a schema change. The staff-invite flow this
consequence once deferred is now built exactly as anticipated — `account_tokens.purpose` grew the
`invite` value with no new table — see
[20260726-staff-invite-accounts](20260726-staff-invite-accounts.md).
