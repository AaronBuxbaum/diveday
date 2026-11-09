# 20261109-operator-browser-and-email-sign-in — Separate database operators from account sign-in

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Aaron requested shop exploration and operator-assisted demo recovery, plus email sign-in for
ordinary users. He clarified that an admin is someone who already has production database access.
Tenant owner and manager roles convey no platform authority. Demo creation must not require an
email or retain the visitor's typed shop name outside its existing cookie.

## Decision

Offer a local operator browser, launched with an explicit database connection. It binds only to
loopback, chooses a random port and launch secret, and requires the secret and exact Origin/Host
for data requests. Every operation runs in a read-only transaction. Search exposes only names,
slugs and demo flags, fifty rows per page. Exact demo selection recovers existing public sample
credentials only after the demo flag and reserved identity namespace pass validation. There is no
real-account impersonation, credential creation, email action or hosted admin role.

Ordinary sign-in gains a separate `magic_sign_in` account capability. It expires after fifteen
minutes, supersedes its previous link, stores only a random token's digest, and is withdrawn with
other account tokens. A purpose-separated HMAC binds the link to the verified account address and
verification epoch. Active non-demo staff accounts alone qualify. Requests have generic deferred
responses and IP/address rate limits. Delivery uses the account's verified address and canonical
application origin, never an operator-supplied recipient.

Opening a link renders a confirmation. Only an explicit POST consumes it. Consumption, live
account checks and session or pending second-factor creation share a transaction. Existing TOTP
requirements remain. Redirects use server-derived shop paths; capability telemetry redaction
includes the new route.

## Alternatives considered

- In-app platform-admin grants: rejected after Aaron clarified that database access is the gate.
- Reusing password-reset tokens: rejected because sign-in and password changes are distinct powers.
- Email at demo creation: rejected; public sample recovery needs no retained visitor identity.

## Consequences

Operators need database access and a local command, but no new production permission system.
The local URL is private and expires when its process stops. Email sign-in requires a verified
address; password sign-in and verification remain available. Rotating the auth secret invalidates
outstanding email bindings. If hosted administration is later required, design explicit platform
authorization before moving any directory reader into the application.
