# 20260826-stripe-tax-is-opt-in-and-provider-owned — Calculate exclusive tax through Stripe Tax

- **Status:** Accepted
- **Date:** 2026-08-26
- **Issue:** [#959](https://github.com/aaronwittman/diveday/issues/959)

## Context

Shops need to support sales tax, VAT, and similar taxes without making DiveDay maintain a
jurisdiction and rate table. Listed prices are pre-tax, and tax must be visible to a diver at
checkout, retained as evidence, and separated from operating revenue in the monthly report. Some
shops handle tax outside DiveDay and need to leave the behavior off.

## Decision

Add an owner/manager-controlled, per-shop `tax_enabled` flag that defaults to false. When enabled,
booking Checkout sessions and staff invoices on the shop's connected Stripe account use Stripe Tax
with every line's tax behavior set to exclusive. Stripe remains the authority for the calculated
amount and the connected account's Stripe Tax settings remain the authority for registrations and
jurisdictions; DiveDay stores the returned tax total and does not reproduce tax rules locally.

Checkout and invoice records snapshot whether tax was enabled and the tax amount Stripe reported.
Party Checkout tax is allocated to its booking rows so payment and reporting records remain
tenant-scoped and reconstructible. An order stores its invoice tax evidence and adjusts it in step
with partial or full refunds.

The monthly report presents verified tax as its own line and subtracts it from net revenue. Imported
history has no Stripe Tax evidence and therefore contributes no fabricated tax amount. Turning tax
off changes future charges only; existing evidence remains unchanged.

## Alternatives considered

- **Maintain internal tax rate tables and jurisdiction rules** — rejected because rate rules change
  frequently across local jurisdictions and maintaining them internally would add massive compliance
  and maintenance overhead.
- **Support inclusive tax pricing locally** — rejected because advertised prices across dive operations
  are predominantly pre-tax, and exclusive calculation directly leverages Stripe Tax line-item calculations.
- **Require manual tax entry during checkout or invoicing** — rejected because automated provider-side
  calculation guarantees accuracy and consistency without burdening staff at point of sale.

## Consequences

- A diver sees Stripe's own tax line on a tax-enabled hosted Checkout page.
- Staff invoices use the same exclusive, provider-calculated tax model as booking Checkout.
- Shops that leave the setting off keep the existing pre-tax charge behavior.
- Tax setup, address collection, registrations, exemptions, and jurisdiction decisions stay in
  Stripe rather than becoming local configuration that could drift.

