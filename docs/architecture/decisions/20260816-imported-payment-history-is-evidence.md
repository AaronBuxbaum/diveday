# 20260816-imported-payment-history-is-evidence — Carry prior payment and receipt history as labelled source evidence, never as a live order

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** [20260725-import-prior-visits](20260725-import-prior-visits.md) only for separately
  imported payment, refund, and receipt evidence. Prior visits remain inert booking-history rows.

## Context

A switching shop can often export more than contact details and prior bookings: it may have a paid
or refunded amount, a receipt number or PDF, and sometimes a Stripe invoice, charge, or payment
intent reference. That information is useful when a staff member answers a customer's question or
an owner assesses a historic month.

It is not a DiveDay order. A current `orders` row is a bill DiveDay issued through the shop's
connected Stripe account; a booking payment can affect readiness; and an order's Stripe lifecycle is
confirmed by a webhook or a direct Stripe read. Reconstructing any of those from another system's
export would create a local fact that DiveDay and the shop's current Stripe account did not observe.
Likewise, an export must never carry a PAN, CVC, reusable payment token, or card-on-file credential
into DiveDay.

The owner still asked for a useful aggregate revenue/refund view. The boundary therefore has to make
the rows visible and traceable, rather than forcing staff to choose between pretending they are live
Stripe data and losing the imported history altogether.

## Decision

- **`imported_payment_history` is a source-evidence table, not an order or payment table.** It is
  person- and shop-scoped and stores the source's calendar date, raw title/status/amount text,
  a conservative direction (`payment`, `refund`, or `unknown`), references, and an optional
  re-stored receipt document. It has no booking, trip, order, checkout, invoice, or payment-method
  foreign key. Importing it does not create a live order, booking payment, readiness state, Stripe
  customer, or provider operation.
- **Orders renders these rows in a visibly separate, unverified source-history section.** Every row
  keeps its source status wording, is linked to its diver rather than a fictional order detail page,
  and can link to an imported receipt only after DiveDay has safely re-stored it. An imported Stripe
  reference is a reconciliation clue, never proof that the current connected account owns or
  confirms it.
- **The monthly report may include a narrow, explicit source contribution.** It adds only rows with
  a readable source date, a non-null parsed amount, one of the two clear directions, and a currency
  equal to the shop's configured reporting currency. Payments add and refunds subtract. Unknown,
  ambiguous, mixed-currency, and unparseable rows stay visible in Orders but cannot enter the total.
  The report calls the contribution unverified, shows its payment/refund components and count, and
  links to the exact date-filtered source rows in Orders. Trip metrics remain tied solely to real
  DiveDay departures.
- **Money parsing is deliberately conservative.** The raw `amount_label` always survives. Numeric
  minor units and currency are populated only where a source code/symbol/field identifies the
  currency without contradiction; a bare amount is not guessed. The parser also refuses conflicting
  notation such as a EUR amount labelled USD.
- **Receipt URLs take the existing safe-ingestion path.** The server fetches only the allowed
  image/PDF kinds, re-stores a successful document under the import-receipts namespace, and drops
  the raw external URL on failure. Orders fails closed and never renders an arbitrary external link.
- **Card credentials stay outside the importer.** Column aliases intentionally exclude card number,
  PAN, CVC, payment-method, and reusable-token fields. A future customer-consented Stripe flow may
  create a new PaymentMethod through Stripe; it must never copy an incumbent credential from CSV.
- **Export carries this history back out.** `imported_payment_history.csv` is separate from live
  orders and its safely held receipt files are bundled with the other exported documents, preserving
  the difference for the next system too.

## Alternatives considered

- **Synthesize paid/refunded DiveDay orders.** Rejected: it gives an external claim a local Stripe
  lifecycle, may change readiness, and produces an order a current shop never issued.
- **Copy an imported card or payment method into Stripe.** Rejected: a source export is not a
  customer-consented, processor-approved token transfer. The application must not handle card data
  or try to manufacture a reusable credential.
- **Replicate every source record into Stripe automatically.** Rejected: creating invoices, charges,
  refunds, or balance transactions in the connected account would misstate what happened there and
  could have financial and tax effects. A later, separately authorized reconciliation workflow may
  use a retained Stripe reference to match an existing object, but it must show the proposed match,
  require a current-account confirmation, and leave unmatched history as evidence.
- **Keep receipt/payment information out of the product entirely.** Rejected: it makes support and
  migration reconciliation harder while offering no safer replacement. The separate, labelled
  surface preserves the useful evidence without promoting it to an operational fact.
- **Parse every numeric-looking amount.** Rejected: a plausible but wrong currency or decimal
  interpretation is worse than an amount that stays visibly unverified and outside the aggregate.

## Consequences

- Owners can see imported historic payments, refunds, receipt links, and source Stripe references
  alongside Orders without mistaking them for live Stripe invoices.
- The revenue headline can be more useful during migration, but remains intentionally not a Stripe
  reconciliation when it includes source history; the page says so and points to the rows.
- The importer has a durable seam for a future *reviewed* Stripe reconciliation feature, without
  expanding DiveDay's card-data scope or changing the current Connect ownership model.
- Tests pin tenant isolation, no operational-table writes, conservative currency/direction inclusion,
  safe document rendering, idempotent re-import, and export portability.
