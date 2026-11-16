# local-orders

Named-diver ancillary amounts due and receipt recording without a payment provider. Billing permission remains owner/manager; any live staff member can record a full payment already received elsewhere. Walk-ins use the existing paid-receipt flow.

Creation uses an explicit local_invoice collection, open status, zero paid amount, no provider ids and no booking id. The customer row lock serializes creation and collection with erasure; a removed customer is refused after the lock. Request UUIDs and equal-payload replay checks prevent duplicate orders and receipts. Receipt collection locks the order, records actual method and included split facts, and writes the existing fee-basis collection journal and paid-order outbox once. It never clears a booking fare or grants package credit. No card is charged and no provider invoice is created.

After collection, counterReceipt is the durable local receipt provenance; absence of Stripe ids alone never qualifies an arbitrary order. Existing external-return permissions, step-up, original-rate arithmetic and audit remain in charge. Erasure removes receipt references and order prose through the existing sweeps while retaining financial facts and anonymous pointers. Unpaid local orders can be voided by billing managers; paid receipts use the existing return workflow.
