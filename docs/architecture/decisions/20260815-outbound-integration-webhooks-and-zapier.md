# 20260815-outbound-integration-webhooks-and-zapier — Emit signed webhooks and a Zapier trigger app; never consume another system's API

- **Status:** Superseded by [20260827-shop-authorized-provider-connectors](20260827-shop-authorized-provider-connectors.md)
- **Date:** 2026-08-15

**Superseded 2026-08-27 on its one-directional constraint only.** The transport decisions below —
HMAC-signed webhooks, at-least-once delivery with backoff and a dead-letter log, one-time OAuth
state, token-scoped reads, and a private (never publicly listed) Zapier integration — all stand and
are what shipped. What the successor reverses is "never consume another system's API": DiveDay may
call a provider's API when a shop has authorized it, on private apps only. The content here is left
as written, including the constraint that is no longer true, so the reasoning that was correct in
August stays readable.

**Proposed, deliberately.** This is [roadmap §1](../../product/features/roadmap.md#1-data-portability-follow-ons-the-wedge)'s
"read API + webhooks," which the roadmap already marks **ADR required**. Accepting it is a
product-owner decision; this record exists so implementation starts from a settled shape instead
of improvising the transport layer under deadline. [20260815-pos-order-emission-completeness](20260815-pos-order-emission-completeness.md)
depends on this ADR's event catalog and adds no infrastructure of its own.

## Context

A real DiveShop360-shop inquiry (2026-08-15) asked, in effect, "how does DiveDay talk to the rest
of my stack?" — [vision.md](../../product/vision.md#non-goals-for-now) already answers that
DiveDay manages the boat day and training side only, never retail inventory, POS, or repairs, and
that a shop's existing systems stay authoritative for both. This ADR is the mechanism behind that
answer.

Constraints a lower-context agent must not miss:

- **DiveDay has no outbound-webhook infrastructure today.** `src/app/api/webhooks/{ses,sms,stripe,whatsapp}`
  are all **inbound** receivers; nothing in the codebase signs or delivers a webhook outward. This
  is genuinely new infrastructure, not an extension of an existing pattern.
- **`src/lib/bearer-tokens.ts` is the right primitive for the read-API's auth, and explicitly the
  wrong one for webhook signing** — its own docstring rules out "a shared secret two systems both
  hold (a webhook signing key)," which "wants an HMAC over the payload, not a stored digest of the
  key." Read-API tokens are possession-based, same as `/waivers/[token]`; webhook payloads need a
  computed signature per delivery.
- **One-directional by design, confirmed with the product owner this session:** DiveDay emits, it
  never calls out to read or write another system's API. No DiveDay-built Shopify app, no
  DiveShop360 connector — a direct competitor has no reason to build the receiving end itself, the
  same dead end as PADI/SSI's absent C-card API (H-10,
  [human-decisions.md](../../product/human-decisions.md)).
- The export schema (`src/lib/export.ts`) is the closest existing analog to what a read API
  exposes — reuse its file/row shapes as the payload shapes rather than inventing a second schema.
- H-26 bounds this to a lifestyle-scale, one-person-maintained build
  ([vision.md](../../product/vision.md#what-kind-of-business-this-is)) — rules out anything with an
  ongoing platform-review or support-queue commitment (a public Zapier listing, a Shopify App Store
  submission) until a real consumer justifies it.

## Decision

**Two surfaces, both read-only from the consumer's side: signed outbound webhooks, and token-scoped
polling reads over the export schema. A private Zapier integration sits on top of the webhooks; no
bespoke per-platform connector is built.**

### Webhooks

- **HMAC-SHA256 over the raw request body**, keyed by a per-shop signing secret generated at
  subscription time (`X-DiveDay-Signature` header, timestamp + signature, replay window matching
  Stripe's own convention since staff are already used to verifying that shape). Never the
  `bearer-tokens.ts` digest scheme — different primitive for a different threat model.
- **Event catalog v1**, each payload the row plus its natural joins, matching the export schema's
  shape:
  - `booking.created`, `booking.paid`, `booking.cancelled`
  - `waiver.signed`
  - `order.paid`, `order.voided`, `order.refunded` — full line items verbatim (kind, description,
    quantity, unit amount); see the POS ADR for why this must never be summarized to a total.
  - `gear_item.checked_out`, `gear_item.returned`, `gear_item.service_due` — gated on
    [20260815-minimal-gear-register](20260815-minimal-gear-register.md) landing; the register is
    designed to be this catalog's first genuinely new payload, not bolted on after.
- **At-least-once delivery, exponential backoff, dead-letter after a fixed attempt count**, with a
  staff-visible delivery log (`webhook_deliveries`: shop, event, endpoint, status, attempt count,
  last error) — same shape as `NotificationDelivery`'s retryable/non-retryable split
  ([20260802-sns-sms-adapter](20260802-sns-sms-adapter.md)), reused rather than reinvented.
- **Subscription management**: a shop settings panel — one endpoint URL, one generated secret
  (rotatable, never re-shown after generation, same posture as an API key), per-event-type toggles.
  A shop that configures nothing sees no new UI element fire and pays no cost.

### Token-scoped reads

- Reuse `bearer-tokens.ts` directly: a per-shop API token, possession-is-authorization, same
  discipline as `/waivers/[token]`. Read-only REST endpoints mirroring the export CSVs
  (`GET /api/v1/bookings`, `/orders`, `/rental-fit`, `/gear-items` once built), filterable by
  `updated_since`, paginated with the existing `offsetPage` shape
  (`src/db/paging.ts`) wherever a keyset cursor isn't already the pattern.

### Zapier

- A **private, unlisted Zapier CLI integration** (Node.js, `zapier-platform-core`), shared via
  invite link to pilot/early shops — not submitted to the public App Directory. Triggers only,
  built as **REST Hooks** (Zapier auto-subscribes/unsubscribes against the subscription-management
  endpoints above); no Actions, since DiveDay never accepts a write from the Zapier side. This is
  the whole "Shopify integration": a shop's own Zap wires a DiveDay trigger to Shopify's (or
  QuickBooks's, or anything else's) native Zapier action — no DiveDay-authored Shopify code exists
  or is planned.

## Alternatives considered

- **A bespoke Shopify app** (OAuth, App Store listing) — rejected: ongoing API-version maintenance
  and a review/support relationship with Shopify is more permanent surface than a one-person
  company should carry (H-26) for a feature with zero validated demand yet.
- **Reuse `bearer-tokens.ts`'s digest for webhook signing** — rejected on the primitive's own
  documented terms: it is a stored-credential digest, not a payload-signing HMAC.
- **Polling-only, no webhooks** — rejected; the roadmap item names webhooks explicitly, and
  Zapier's REST Hook pattern is materially cheaper for a consumer than a poll loop.
- **Public Zapier App Directory listing from day one** — rejected; adds a review process and a
  support commitment before a single real external consumer has validated the event shape.
- **Summarized/aggregated event payloads** (e.g., an order total with no line items) — rejected;
  see the POS ADR — a $0 comp is only visible on the receiving end if the line items survive.

## Consequences

- **Easy:** the read-API auth is a direct reuse of an existing, well-understood primitive; the
  payload shapes reuse the export schema instead of a second data model; a shop that never
  configures a webhook or requests a token pays zero cost.
- **Hard / new:** HMAC signing, retry/backoff, and a dead-letter delivery log are genuinely new
  infrastructure with no existing code to extend; the Zapier CLI app is a small but real second
  codebase (Node.js, versioned independently, its own auth flow for the API token).
- **Commits us to:** treating the event catalog as a public API contract once a real subscriber
  exists — a breaking payload change becomes a `v2`, not a silent edit, the same discipline the
  export CSV schema already implies.
- **Escape hatch:** if nobody ever subscribes a webhook or requests a token, the cost of leaving
  this unused is one dormant settings panel and an empty delivery-log table — no safety-critical
  path depends on it, and nothing here touches admission, readiness, or the manifest spine.
- **On acceptance (not before):** add a row to `docs/architecture/overview.md`'s stack table once
  the webhook delivery mechanism ships for real (it isn't there yet, matching the precedent of
  [20260804-boat-resource-model](20260804-boat-resource-model.md), which also stays out of that
  table until built).
