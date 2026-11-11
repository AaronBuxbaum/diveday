# pricing-volume

Owns native-currency recorded-collection statements and original-rate refund credits.
`index.ts` is its public contract. Source receipts and immutable collection lots live in
`src/db/collection-ledger.ts`; no report-line revenue reader defines the billing base.

Closes serialize on the shop row. Closed figures and lot allocations never change; later
statements reference earlier statements for credits and carry unused credit in fee units.
The existing Stripe reporting adapter is USD only. Other currencies are stated separately and
held unreported, never relabeled or converted.

See [the billing ADR](../../../docs/architecture/decisions/20261110-recorded-collections-own-billing.md)
and [test-mode setup](../../../docs/engineering/percentage-billing-setup.md).
