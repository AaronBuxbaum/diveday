/**
 * **The payments module's door** (issue #2754): Stripe: checkout, Connect, customers, invoicing, payouts, promotions, settlement, refunds and the webhook, behind one door. The Stripe key, client and request-log helpers are exported too. Code outside `src/lib/payments` imports from here, so a sibling can be split or merged without a repo-wide edit; `scripts/check-architecture.mjs` refuses a deep import.
 */
export * from "./checkout";
export * from "./connect";
export * from "./customer-address-form";
export * from "./customers";
export * from "./erasure-failure";
export * from "./invoicing";
export * from "./payment-sources";
export * from "./payout-summary";
export * from "./promotions";
export * from "./refund-failure-reason";
export * from "./settlement";
export * from "./stripe-client";
export * from "./stripe-keys";
export * from "./stripe-request-log";
export * from "./webhook";
