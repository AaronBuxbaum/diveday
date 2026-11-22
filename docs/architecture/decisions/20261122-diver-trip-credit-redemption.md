# 20261122-diver-trip-credit-redemption — Spend promotional credit from a delivered readiness link

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Staff can grant and redeem promotional trip credit, but a diver should be able to apply their own
balance. A booking browser can receive an undelivered readiness link without proving control of the
matched person's contact, so that link cannot authorize access to their balance.

## Decision

A live delivered readiness link for an identity-confirmed booking can show the current-currency
balance and apply credit to that booking's eligible full fare. The server derives the shop, person,
and booking from the capability. The debit transaction locks the booking, person and capability
rows and verifies the capability again before using the same fare, source, balance and replay rules
as staff redemption. Credit remains available independently of Stripe and of the boarding-payment
requirement. An undelivered or held link cannot view or spend the balance.

## Alternatives considered

- Trust the post-booking redirect: it does not prove control of the matched person's contact.
- Use card checkout: it would mix promotional value with provider-backed payments.

## Consequences

This serves existing eligible unpaid bookings from the delivered link; it does not yet offer credit
inside the initial public checkout or support partial and mixed payment. Cancellation restoration
and cash-refund rules remain unchanged. Revisit the authority boundary if a dedicated diver account
or a separately verified checkout identity becomes available.
