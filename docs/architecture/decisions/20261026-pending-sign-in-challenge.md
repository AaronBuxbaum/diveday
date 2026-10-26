# 20261026-pending-sign-in-challenge — Use a single-use pending second-factor sign-in challenge

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

The owner approved [#3078](https://github.com/AaronBuxbaum/diveday/issues/3078), split from RP05:
after a correct password, staff with two-factor enabled enter only an authenticator or recovery
code. No password is retained across requests, and no authenticated session exists before the
second factor succeeds. The custom credentials endpoint and existing enrollment, recovery,
rate-limit and token-hashing contracts remain authoritative.

## Decision

Use an explicit `account_sign_in_challenges` table beside account security. Each row contains
only its id, shop/account ownership, a SHA-256 digest of a server-generated 256-bit random handle,
absolute expiry, five-attempt budget and creation time. There is no password, password-derived
value, factor secret, email, destination, device fingerprint or role snapshot in the row.

The handle travels in `__Host-diveday.pending_sign_in`: HttpOnly, Secure, SameSite=Strict,
Path=/, no Domain, Max-Age=300. Only loopback e2e uses a distinct unprefixed insecure name.
Duplicate/malformed cookies fail closed. The code endpoint accepts no account identity. It
rejects mismatched origins against the configured server origin; missing Origin is allowed
only for in-process server calls without browser fetch metadata. The isolated e2e fleet
uses its server-configured loopback PORT for transport while printing a canonical example host.
No request Host selects an accepted origin. Server Actions retain their
own POST/origin protections.

Issuance checks the password before locking, keeping the exact compared hash only in request memory,
then rejects a changed hash or current identity under the account lock. Demo bypass eligibility is
rechecked against the current shop. Rejected passwords never lock an account. Completion locks account, person,
security and challenge, rechecks live eligibility and enabled two-factor, then consumes the
factor and challenge and creates the Better Auth session inside one Drizzle transaction.
The configured provider over that transaction retains the existing token-digest adapter.
Entering pending clears any browser session/cache cookies; it does not revoke that older session
row. Back or failure leaves the browser signed out. Cookie delivery follows commit. A provider failure rolls back all consumption; cookie-write
failure attempts to revoke the new session. IP, account-email and challenge budgets all apply;
invalid-code attempts commit their decrement without extending expiry.

Success, Back, restart, password changes, factor disable, account disable/removal, erasure and
sign-out-everywhere invalidate pending proof. Physical account/shop removal cascades it.
Expired proof is invalid immediately. Bounded issuance sweeps and the existing weekly retention
job hard-delete expired rows; unused expired rows may remain until a sweep. They are never exported.

## Alternatives considered

- **Provider two-factor plugin** — its built-in sign-in hooks and enrollment model do not match
  the custom credential/security policy and it creates a session before pending.
- **Reuse `auth_verifications`** — adapter scaffolding lacks explicit attempt and ownership contracts.
- **Repeat credentials** — safe, but preserves the approved usability problem.

## Consequences

Two-factor sign-in works without retained passwords or JavaScript. Atomicity depends on the
provider's public adapter accepting a Drizzle transaction; integration and real-Postgres tests
guard that boundary. Revisit on a provider change that breaks it: replacing the pending store
or provider adapter requires a new ADR and the same consumption/session proofs.
