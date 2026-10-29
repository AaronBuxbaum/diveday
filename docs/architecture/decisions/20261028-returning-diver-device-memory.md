# 20261028-returning-diver-device-memory — Remember a booker only by shop and opt-in

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Public booking forms handle names and email on shared devices. An editable `?booked=1` flag or a
shareable readiness link cannot prove that a browser opted in. Memory must stay shop-scoped and
must not affect confirmed booking success.

## Decision

1. Offer an unchecked opt-in on non-embedded public bookings. Only after the booking succeeds,
   issue a PII-free receipt bound to the shop, booking, person, trip and undelivered readiness
   capability for the redirecting browser. The emailed readiness capability cannot authorize it.
2. Create a random opaque per-shop tab slot only after opt-in; hold it in `sessionStorage` for at
   most 24 hours and store only its hash in `booking_capabilities`. The row also carries a clear
   generation and strictly increasing receipt order. Receipt issuance is bounded to a 500ms
   response budget, with transaction-local 250ms lock and 400ms statement limits. Rows contain no
   identity and expire after 24 hours.
3. After hydration, public navigation may retry an unacknowledged receipt. For `/s/{shopSlug}`,
   the server resolves the slug and scopes the database read to that shop id. For `/ready/{token}`,
   it validates the readiness capability and derives the shop scope from that row. The database
   applies the scope before returning identity. Per-receipt local keys and server-issued ordering
   keep delayed responses from replacing a newer booking; acknowledge only after local storage
   succeeds.
4. Store name and email per shop for 30 days. Before prefill, the form checks expiry against
   server time; without an online time check, it leaves the fields blank. "Not you?" clears this
   shop's memory and fences or revokes the tab slot. Open forms hear same-tab and cross-tab clears,
   remove only untouched remembered values, preserve manual edits and retain a later opt-in.
5. Keep confirmation independent of prefill and local storage. Device-memory delivery is best
   effort: leaving before hydration or closing the browser can lose the convenience. JavaScript
   is required. Old global memory is removed without migration.

## Alternatives considered

- **Trust `?booked=1` or the emailed readiness capability** — neither proves this browser opted
  in.
- **Persist identity in a server session or cookie** — adds a PII persistence surface.
- **Wait for local storage before confirming** — hides an already successful booking on browser,
  storage or network failure.

## Consequences

The tab slot is opaque and short lived; duplicated tabs may initially share `sessionStorage`, so
clear generations and cross-tab notifications fence stale work. A closed browser cannot run
cleanup, and expired bytes may remain until a later storage read or write; 30 days limits reuse,
not exact physical deletion. If the browser cannot persist a clear marker or deliver a cross-tab
event, clearing another open form is best effort and the UI reports partial completion. Booking
confirmation does not depend on local storage or receipt redemption.
