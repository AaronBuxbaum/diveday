# Recorded purchases

Records money already received, not payment acceptance. `recordPurchase` reuses the paid counter
order writer and its source-owned immutable collection ledger. No card data, Stripe invoice,
notification, inventory, checkout cart or automatic provider transaction is created. Booking
payments stay on the booking payment trail, so a receipt cannot also be counted as a manual seat.

The entered lines are received prices, including any tax and tips. Explicit included tax, tips
and pass-through lines are excluded from the existing fee. Original splits stay in
`orders.counterReceipt`; retained splits are prorated together through partial returns. Missing
tax is explicitly unknown, not inferred. Native shop currency is checked against the form and
frozen on the order. A stale currency form must refresh. Counter backdating does not backdate the
fee ledger into a closed statement.

Every live staff member may record a receipt. A request UUID is the order id: equal retries return
the same receipt, a changed payload is refused. Refund rights and money step-up are required to
record an external return. The shop returns money itself first. The receipt row lock, expected
refunded total and activity-event request UUID prevent concurrent or repeated returns from
reducing the receipt twice. Provider-backed invoices are refused. Refunds reverse only the
original fee lots. Square linking is a separate integration and must not write another receipt.

Receipt creator/time, original split/reference and line items persist on Orders. Refund amount,
reason, staff actor and time use the existing staff activity trail and its existing retention and
erasure rules; the page reads the latest 50 rows. Billing lots remain immutable under their own
retention contract. References and notes must never contain payment credentials.

Accounting boundary: Orders and the shop export preserve the included split. Existing QuickBooks
sales receipts still use gross received-price lines and do not map this split into QuickBooks tax
or gratuity accounts. Reconcile that classification in the accounting system; this feature does
not claim automated tax accounting. Provider connection/reconciliation must not create another
purchase for a receipt already recorded here.
