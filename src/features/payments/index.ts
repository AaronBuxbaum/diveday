/**
 * **The payments module's door** (issue #2754): Stripe: checkout, Connect, customers, invoicing, payouts, promotions, settlement, refunds and the webhook, behind one door. The Stripe key, client and request-log helpers are exported too. Code outside `src/lib/payments` imports from here, so a sibling can be split or merged without a repo-wide edit; `scripts/check-architecture.mjs` refuses a deep import.
 */
export * from "../../lib/payments/checkout";
export * from "../../lib/payments/connect";
export * from "../../lib/payments/customers";
export * from "../../lib/payments/erasure-failure";
export * from "../../lib/payments/invoicing";
export * from "../../lib/payments/payment-sources";
export * from "../../lib/payments/promotions";
export * from "../../lib/payments/settlement";
export * from "../../lib/payments/stripe-client";
export * from "../../lib/payments/stripe-keys";
export * from "../../lib/payments/stripe-request-log";
export * from "./customer-address-form";
export * from "./payout-summary";
export * from "./refund-failure-reason";
export * from "./webhook";
