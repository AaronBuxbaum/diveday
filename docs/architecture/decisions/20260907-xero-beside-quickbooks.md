# 20260907-xero-beside-quickbooks — Xero is the fourth connector, and it writes cash rather than invoices

- **Status:** Accepted
- **Date:** 2026-09-07

Extends [20260827-shop-authorized-provider-connectors](20260827-shop-authorized-provider-connectors.md),
which requires that a further provider be recorded here rather than added as one more file.

## Context

QuickBooks Online is one of the two accounting systems a small dive shop actually runs. Outside
North America the other one is usually Xero, and a shop on Xero currently has the Zapier hook or a
CSV — neither of which can write a receipt keyed to a DiveDay order, which is the whole point of the
QuickBooks adapter.

N-52 on the 2026-09-07 decision sheet asked for exactly this and the owner said build it. The
register was built so that the fourth provider costs a file rather than a subsystem; this is the
item that tests that claim, and the claim held — the connection row, the sealed credential envelope,
the one-time OAuth state, the at-least-once outbox, the retry ladder, the disconnect/reconnect
behaviour and the settings projection are all reused unchanged. What is new is one adapter, one
callback route, one card, one enum value and two environment variables.

**The one modelling question Xero forces, and QuickBooks did not.** QuickBooks has a SalesReceipt:
money already received, no accounts receivable, one call. Xero has no such entity. Its options are:

- an **ACCREC invoice**, optionally followed by a **Payment** against a bank account — two calls,
  two idempotency guards, and an AR balance sitting on the shop's books for as long as the second
  call has not landed; or
- a **bank transaction** (`RECEIVE` in, `SPEND` out) against a bank account, which is Xero's own
  shape for a cash sale — one call, no AR, and a refund is the mirror image of the sale.

DiveDay only ever reports money that has *already* moved through Stripe. There is no such thing as
a DiveDay invoice a diver has yet to pay, so a shop's Xero should never show a DiveDay debtor.

## Decision

**Xero joins the register as an OAuth connector taking `order.paid` and `order.refunded`, and it
writes each one as a bank transaction rather than an invoice.**

- **`RECEIVE` for a paid order, `SPEND` for a refund**, both against the shop's own two chart-of-
  accounts codes: a **sales account code** the sale line lands on, and a **bank account code** the
  money moved through. Both are typed into Settings by the shop, because the scopes below cannot
  read a chart of accounts and should not be widened to.
- **Scopes are `offline_access accounting.transactions accounting.contacts` and nothing else.**
  `offline_access` is what buys a refresh token; the other two are the narrowest pair that can
  attach a transaction to a contact. No `accounting.settings`, so DiveDay can neither read nor edit
  the shop's accounts.
- **`LineAmountTypes: "NoTax"`.** DiveDay carries no tax breakdown on an order. A connector that
  invented one would be putting a number in a shop's books that its accountant did not choose.
- **One read-back, and it is an address rather than a fact.** A Xero token does not name an
  organisation; every Accounting API call carries an `xero-tenant-id`, and `GET /connections` is
  the only way to learn one. It is read once at connect time into `external_account_id` — the same
  slot QuickBooks fills with its realm id — and never again. This stays inside 20260827's
  "read back only what keeps that push idempotent".
- **The refund guard is keyed per refund, never per order.** An order can be refunded in slices
  (issue #699) and each event carries that slice's delta, so the sync record for a `SPEND` is keyed
  on the event's idempotency key. Keying it on the order is the bug that lost every refund after
  the first in QuickBooks, and the same shape would lose them here.
- **A rotated refresh token is persisted before it is used.** Xero rotates on every refresh, so a
  dropped rotation leaves the stored token spent and the connection dead at the next cron pass.
- **Still a private app.** No Xero App Store listing, no marketplace submission — H-26 and
  20260827's private-app rule apply unchanged. A shop authorizes the deployment's own registration.

## Alternatives considered

- **An ACCREC invoice plus a Payment.** Rejected on both counts above: it overstates receivables in
  the window between the two calls, and it doubles the failure surface (two writes, two idempotency
  records, a partial state where an invoice exists and its payment does not) for a transaction that
  was never on credit in the first place.
- **An invoice with no payment at all.** Rejected outright: every DiveDay order would land in the
  shop's aged-receivables report as money owed by a diver who has already paid.
- **Pull the `xero-node` SDK.** Rejected. The four calls this needs are ordinary JSON POSTs over the
  same injectable `fetch` seam every other adapter uses, and a runtime dependency would buy an
  OAuth helper the repo already has, in exchange for an ADR, a supply-chain surface and a version
  to chase. There is no new runtime dependency in this change.
- **Wait for a shop to ask.** Rejected as the decision sheet's own answer: the owner approved N-52
  for a bounded cohort, and the register's cost claim is only worth anything if it is exercised.
- **Reuse the `incomeAccountId` setting QuickBooks already has.** Rejected. It is a numeric
  QuickBooks account *id*; Xero wants a short alphanumeric *code* from a different chart, and there
  are two of them. Sharing the field would make one provider's Settings edit silently corrupt the
  other's.

## Consequences

- **Easy:** a shop on Xero gets the same thing a shop on QuickBooks gets, from the same page, with
  the same disconnect and reconnect behaviour and the same delivery log.
- **Hard / new:** a third OAuth client registration to keep alive, and a third API deprecation
  cycle to follow. Xero's refresh tokens also expire after 60 days of disuse, so a shop that
  connects and then goes quiet over a low season comes back to a connection that must be
  reconnected. That fails closed and visibly (the card reads "Needs attention"), which is the right
  outcome, but it is a support conversation that QuickBooks does not generate.
- **Commits us to:** the two account codes staying a shop-entered setting for as long as the scopes
  stay narrow. Widening to `accounting.settings` to offer a dropdown would be a new decision here,
  not a refactor.
- **Escape hatch:** unchanged from 20260827. `xero.ts`, its registry entry, its callback route, its
  card, its two env keys and its rows; nothing else depends on it.
