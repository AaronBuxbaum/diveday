# 20261019-single-address-token-table — Address confirmations and alerts use purpose-isolated bearer tokens

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Notification kinds that sent confirmation and verification emails were consolidated into `address_confirmation` with a `purpose` discriminator (`account`, `shop_contact`, `shore_alert`). The underlying token tables (`account_tokens`, `shop_contact_email_confirmation_tokens`, and `shop_shore_alert_tokens`) share common semantics: hashed bearer credentials, expiry policies, and one-time consumption that marks a verified address.

The shore contact confirmation token carries live consent (H-20261014-stale-roll-call-recipients) for roll-call alerts, and each departure alert includes a non-expiring `stop` link. Merging token flows requires strong security boundaries to guarantee tokens cannot be redeemed cross-purpose or cross-tenant.

## Decision

Consolidate address confirmation and verification token semantics around purpose-isolated bearer tokens:

1. **Purpose-bound isolation:** Every token issuance and verification path requires an explicit purpose (`account`, `shop_contact`, `shore_alert`). A token issued for account verification or front-desk confirmation cannot be checked or redeemed as a shore alert confirmation or stop link, and vice versa.
2. **Consent and unsubscribe protection:** Shore alert confirmations continue to require active confirmation via `/confirm-contact/[token]` before any alert is delivered. Stop links (`/unsubscribe/[token]` and shore alert stop links) remain non-expiring, idempotent upon repeated clicks, and notify shop owners when stopped.
3. **Database constraints:** Token records store SHA-256 hashes only. One live token of a given purpose exists per entity at any time; fresh issuances supersede prior outstanding tokens.

## Alternatives considered

- **Single universal capabilities table:** Merging all auth, session, waiver, and capability tokens into one generic table was evaluated in architectural review L04-1. Rejected to preserve strong foreign-key constraints, tenant isolation, and table-level retention pruning policies.
- **Stateless HMAC links:** Rejected because revocation, superseding on re-issuance, and one-time consumption (preventing corporate link pre-scanners from consuming tokens) require persistent state.

## Consequences

- Token verification paths enforce purpose checks at both query and application boundaries.
- Cross-purpose substitution attacks fail immediately with null resolutions.
- Retention rules and erasure sweeps remain distinct per domain boundary while maintaining unified notification kinds.
