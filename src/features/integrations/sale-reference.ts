/**
 * What an accounting entry calls the DiveDay sale it records: a staff order,
 * a diver's online booking checkout or a post-dive tip (ADR
 * 20261014-checkouts-reach-integrations). Ledger text an accountant reads in
 * QuickBooks or Xero, beside the provider's own English, so it is written
 * once here rather than per adapter.
 */
export type SaleSource = "order" | "checkout" | "tip";

const NOUN: Record<SaleSource, string> = {
  order: "order",
  checkout: "booking",
  tip: "tip",
};

function noun(source: SaleSource | undefined): string {
  return NOUN[source ?? "order"];
}

/** "DiveDay order …", "DiveDay booking …", "DiveDay tip …". */
export function saleReference(payload: { source?: SaleSource; orderId: string }): string {
  return `DiveDay ${noun(payload.source)} ${payload.orderId}`;
}

/** "DiveDay refund for order …", and the same for a booking or a tip. */
export function refundReference(payload: { source?: SaleSource; orderId: string }): string {
  return `DiveDay refund for ${noun(payload.source)} ${payload.orderId}`;
}

/** "Refund for DiveDay order …", the refund line's own description. */
export function refundLineDescription(payload: { source?: SaleSource; orderId: string }): string {
  return `Refund for ${saleReference(payload)}`;
}
