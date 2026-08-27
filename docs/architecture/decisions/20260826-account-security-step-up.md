# 20260826-account-security-step-up — Re-authenticate sensitive staff actions with session-bound 2FA

- **Status:** Accepted
- **Date:** 2026-08-26
- **Issue:** [#701](https://github.com/AaronBuxbaum/diveday/issues/701)

## Context

Staff accounts already use database-backed Better Auth sessions, but a signed-in browser could
perform a money mutation or export without a fresh second-factor check. Session revocation also
needs to be visible and effective against a previously issued session, while recovery material
must not become readable from database rows or logs.

## Decision

- Make TOTP optional per account. When enabled, sign-in requires either the current authenticator
  code or one unused recovery code.
- Store the TOTP seed sealed with the application secret and store only HMAC-derived recovery-code
  hashes. Show generated recovery codes once during enrollment, in a short-lived encrypted,
  httpOnly cookie; do not export or show them again after that window.
- Keep active sessions in the database, show the session's user agent, IP address, and last-seen
  timestamp to the account owner, and revoke either one session or all sessions by deleting rows.
  Every staff surface continues to re-read live roles and session validity.
- When TOTP is enabled, require a successful second factor before money actions, shop exports, or
  backup-destination changes. Grant the result to the current database session and purpose for
  fifteen minutes; a different or revoked session cannot reuse it. The challenge only accepts a
  same-shop internal return path.
- Keep the sign-in, step-up, session-revocation, and recovery-code failures generic to avoid
  account or factor enumeration.

## Alternatives considered

- **Rely on the initial password sign-in for the whole session** — rejected because an unattended
  or stolen browser can reach money and data-export controls without a fresh factor.
- **Put a reusable second-factor flag in the browser cookie** — rejected because it would survive
  database session revocation and would not bind approval to the session that performed the action.
- **Store raw TOTP or recovery codes for convenience** — rejected because a database read would
  become an immediate account takeover.
- **Require TOTP for every account immediately** — rejected because enrollment is optional during
  the pilot and shops need a usable recovery path while the policy is being reviewed.

## Consequences

- A staff member with TOTP enabled may need to repeat the action after approving a challenge; the
  original form is intentionally not retained.
- Export and backup endpoints are protected in addition to the visible settings page, so a direct
  request cannot bypass the UI.
- TOTP secrets, recovery codes, and session metadata are sensitive account-security data. The
  privacy/security review remains an operational gate: confirm retention, access, incident
  response, and whether IP/user-agent display is appropriate before production rollout.
- Disabling TOTP removes the secret, recovery hashes, and previous TOTP replay marker. Revoking all
  sessions remains the emergency response when an account or device is suspected compromised.
