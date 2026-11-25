# 20261125-diver-sign-in — Sign divers in per shop with an emailed link and a capability session

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Aaron asked for divers to sign in by magic link and keep a profile that grows with each trip
([#4969](https://github.com/AaronBuxbaum/diveday/issues/4969)). Divers had only per-booking bearer
links; staff sign in through better-auth. A signed-in diver is the verified identity #4245
needed to spend trip credit on the booking form. `people` rows are per shop. Experience beats hardening
(`.claude/rules/ux-over-hardening.md`): one tap, a long session, no codes.

## Decision

- **Identity is a person row in one shop, proven by its email.** `/s/<slug>/sign-in` asks for an
  email; a live person there with that address is mailed a link at the address on the row. Every
  outcome, rate limit included, shows the same "check your email" page; the lookup and send run
  after the response.
- **Both credentials are `capabilities` rows**, no new table: `diver_sign_in` (15 minutes, spent
  once, a second request adds a link) and `diver_session` (reusable, 180 days, one per device),
  each naming a person in a shop. Tokens are 256-bit, stored as SHA-256 digests. Policy is in
  `CAPABILITY_POLICY`; the rows are `src/db/diver-sign-in.ts`.
- **One tap.** `/diver-sign-in/<token>` submits itself on arrival, so a mail scanner that fetches
  without running the page spends nothing. Spending the link and minting the session are one
  transaction that re-checks the person is live.
- **A separate cookie.** `diveday_diver`, HttpOnly, SameSite=Lax, path `/s/<slug>`: sent only to
  that shop's public pages, never to `/shop/**` or another shop. better-auth and the edge proxy
  never read it; a staff session is untouched.
- **What it reads:** its own person in its own shop — My profile (`/s/<slug>/me`: details, trips,
  credit, cards), the booking form's prefill, and a self-edit of phone and emergency contact. The
  email changes only at the shop. A self-edit withdraws no links.
- **Trip credit:** `redeemWithAuthority` gains `diver_session`, re-proving under the trip, booking
  and beneficiary locks that the session names the booking's person and the credit's, and that the
  seat's identity is not held. The form's attempt id makes a resubmit the same spend; any refusal
  falls through to the normal checkout.
- **Ending:** sign out revokes the row; a delete or merge leaves it opening nothing (`merge:
  "ends"`); an erasure deletes it. Retention prunes both 90 days after expiry.

## Alternatives considered

- **better-auth diver accounts** — global accounts fit staff, not per-shop people, and would put a
  diver session where `/shop/**` gates look.
- **A new sessions table** — duplicates the hashing, expiry, revocation and erasure the capability
  table already has.
- **A GET landing that spends the link** — mail scanners would burn it.
- **One cross-shop profile** — needs merging people across tenants.

## Consequences

A diver signs in once per device and shop for half a year. A JavaScript-running scanner can spend a
link; the diver asks again. A cross-shop profile or passkeys would give the session row an account
and widen the cookie path.
