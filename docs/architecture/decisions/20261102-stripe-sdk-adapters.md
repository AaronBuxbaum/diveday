# 20261102-stripe-sdk-adapters — Call Stripe through the official SDK, under the app's own policies

- **Status:** Accepted
- **Date:** 2026-11-02
- **Supersedes:** "No new SDK dependency" in [20260719-stripe-connect-orders](20260719-stripe-connect-orders.md) and the SDK alternative in [20261007-subscription-billing](20261007-subscription-billing.md)

## Context

Eight adapters built Stripe requests by hand: form encoding, headers, error parsing, timeouts and
webhook HMAC (issue #3240). The product owner directed on 2026-11-02 that a maintained library
replace in-house code unless review finds a major problem. The SDK's defaults differ from what the
adapters guarantee: an 80-second timeout, a retry even at zero retries, a pinned API version, and a
webhook check that accepts any future timestamp.

## Decision

Add `stripe` **23.1.0**, pinned exact: MIT, published by Stripe (`stripe-bindings`) from
`github.com/stripe/stripe-node`, no runtime dependencies, server-only. `src/lib/payments/stripe-client.ts`
is the one place a client is built, per call with the key chosen for that call
(`secretKeyForCall`), over the adapter's injected `fetch`:

- **10-second timeout** (`MARK_PAID_TIMEOUT_MS` asks for 30 per request) and
  `maxNetworkRetries: 0`. The SDK still retries `ECONNRESET`/`EPIPE` once; the transport strips
  that code, so every call is one request.
- **No API version on the wire.** The SDK names its release's version on every request; the
  transport deletes it, so Stripe keeps answering at the account default the fixtures were captured
  at. Typed resources describe the SDK's version, so calls use `rawRequest` and every answer still
  passes the adapter's Zod schema. `stripe-api-version.test.ts` allows exactly that deletion.
- **A non-2xx is never a success.** The SDK accepts JSON without an `error` field at any status;
  the transport gives every non-2xx an error envelope.
- **After a mutation went out, only Stripe's refusal is `failed`:** a 4xx, not 409, with
  Stripe's error envelope (`stripeRefused`). Silence, a 5xx, a 409 or a gateway status is
  `unanswered`.
- **Webhook:** `Stripe.webhooks.constructEvent` on the raw body, plus our own absolute 300-second
  window on exactly one `t=`; any non-JSON-parse throw is `invalid_signature`. The live/test
  secret cross-check stays in the route.
- Telemetry off; `X-Stripe-Client-User-Agent` dropped and `User-Agent` set to `DiveDay`, so no
  runtime details leave. Connected account and idempotency keys are request options. Provider interfaces,
  fakes and `fetch` injection are unchanged.

## Alternatives considered

- **Keep `fetch`** — the direction above; no major problem was found.
- **Typed resource methods** — their params and shapes are the SDK's pinned version, not the
  account's: `promotion_codes` takes `promotion`, invoice items lose `unit_amount`.
- **Pin `apiVersion`** — a policy change needing a fixture re-capture; not this change.

## Consequences

Wire differences, pinned in `stripe-client.test.ts`: the SDK adds `Accept` and a random
`Idempotency-Key` on an unkeyed POST; a GET carries a form `Content-Type`; a 2xx void or
resend whose body is not JSON is now `failed`. The package is 18 MB unpacked; bundle impact was not
measured. Revisit when pinning a version (then typed methods become usable) or if a later SDK
changes the retry or header behavior `stripe-client.test.ts` pins; the escape hatch is one file.
