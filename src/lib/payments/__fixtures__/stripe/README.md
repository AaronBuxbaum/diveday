# Stripe contract fixtures

Real-shaped Stripe payloads, pinned to one API version, that the **production**
parsers in `src/lib/payments/` and `src/app/api/webhooks/stripe/route.ts` are
driven with.

## Why these exist

Every other payments test injects a fake `fetch` and hands the code a payload
the test itself wrote. That proves the code is self-consistent; it proves
nothing about Stripe. A field Stripe renamed, moved, or removed leaves the whole
suite green and the shop's money stuck.

That is not hypothetical here. `refundInvoice()` (`../../invoicing.ts`) reads
`invoice.payment_intent`, a field Stripe **removed from the Invoice object** in
the Basil release (`2025-03-31.basil`), replacing it with the `payments` list of
`InvoicePayment` objects and `confirmation_secret`. Every hand-written test
payload in `invoicing.test.ts` still has `payment_intent`, so every one passes.
`invoice.paid.json` here does not, because the real object does not — and
`../../stripe-contract.test.ts` pins what the code actually does with it.

## Layout

```
<api-version>/
  objects/   bare API responses, as GET/POST /v1/... returns them
  events/    webhook Event envelopes, one per type route.ts dispatches on
```

The **directory name is the API version**, so every file names its own version
by its path. `index.ts` holds that version once, as
`STRIPE_FIXTURE_API_VERSION`; `../../stripe-api-version.test.ts` is the guard
that keeps the directory, each event's own `api_version` field, and any version
the production code pins from drifting apart. Bumping the version therefore
cannot land without re-capturing.

## These are hand-authored, not captured

**Nothing here came off the wire.** Every payload was written by hand from
Stripe's published object references for `2026-07-29.dahlia` and cross-checked
against the fields the code actually parses. They are correct in *shape* — key
names, types, nullability, nesting, which fields exist at all — which is the
property the contract tests need. They are not correct in the sense of "this is
what your account returned": ids, urls, amounts and secrets are invented, and no
field that only a live account can produce (real `client_secret`s, balance
transactions, requirement hashes) is meaningful.

Treat a fixture as evidence about *shape*, never about values.

## Re-capturing against a real test-mode account

Do this when bumping `STRIPE_FIXTURE_API_VERSION`, when adding a handled event
type, or whenever the guard test goes red.

1. Use a **test-mode** account, never live. Export a restricted test secret key:
   `export STRIPE_TEST_KEY=sk_test_...`. Never commit it — `.env*` is gitignored
   and these fixtures are not.
2. Pin the version explicitly on every call so the capture is reproducible
   rather than whatever the dashboard default happens to be that day:

   ```sh
   VER=2026-07-29.dahlia
   curl -s https://api.stripe.com/v1/invoices/in_XXX \
     -u "$STRIPE_TEST_KEY:" \
     -H "Stripe-Version: $VER" \
     -H "Stripe-Account: acct_XXX" | jq . > "$VER/objects/invoice.paid.json"
   ```

   For a connected-account object, keep the `Stripe-Account` header — the shape
   can differ from the platform's own.
3. For **events**, do not hand-build the envelope. Take a real delivery:
   - `stripe listen --forward-to localhost:3000/api/webhooks/stripe --latest`
     prints deliveries, or
   - `stripe events retrieve evt_XXX --api-version "$VER"`, or
   - copy the payload from Dashboard → Developers → Webhooks → event → "Event
     data".

   Set the webhook **endpoint's** API version to `$VER` too. Stripe delivers an
   event at the version the *endpoint* is configured for, which is not
   necessarily the account default — that is the trap this whole directory
   exists to close.
4. Scrub before committing: replace customer emails and names, invoice/receipt
   urls, `client_secret`, `request.id`, and anything else identifying. Keep the
   key set and types exactly as returned — scrubbing a *value* is fine, deleting
   a *field* defeats the purpose.
5. Re-run `pnpm test src/lib/payments/stripe-contract.test.ts --reporter=dot`
   and `pnpm test src/lib/payments/stripe-api-version.test.ts --reporter=dot`.
   A parser that no longer accepts a re-captured payload is the finding, not a
   fixture to bend back into shape.

## The repo pins no API version

Worth stating plainly, because it is the reason a fixture set alone is not
enough: **no code in this repo sends a `Stripe-Version` header.** Every call in
`src/lib/payments/` goes to `https://api.stripe.com/v1/...` with only
`Authorization`, `Content-Type`, `Stripe-Account` and `Idempotency-Key`. Stripe
therefore serves whichever version the platform account's dashboard is set to,
and a webhook endpoint delivers at whichever version that endpoint is set to —
both changeable by a human in a browser, with no deploy and no diff.

`../../stripe-api-version.test.ts` records that state and fails the moment a pin
appears anywhere in the payments code without these fixtures moving with it.
