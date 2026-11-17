import type { NewOrderLineItem } from "@/db/orders";
import { currencyFractionDigits, majorToMinor } from "./money";
import { MAX_LINE_ITEMS_PER_ORDER } from "./order-limits";

const ANCILLARY_LINE_KINDS = ["merchandise", "rental", "other", "pass_through_fee"] as const;
export const RECEIPT_METHODS = ["cash", "card_machine", "bank_transfer", "other"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

/** Exact entered amounts, including zero; missing or malformed is never zero. */
export function purchaseAmount(value: string, currency: string): number | null {
  if (
    !/^\d+(?:\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > currencyFractionDigits(currency)
  )
    return null;
  const cents = majorToMinor(Number(value), currency);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 2147483647 ? cents : null;
}
export function purchaseFormTotal(
  rows: readonly { quantity: string; unitAmount: string }[],
  currency: string,
): number | null {
  let total = 0;
  for (const row of rows) {
    const amount = purchaseAmount(row.unitAmount, currency);
    if (amount === null || !/^[1-9]\d*$/.test(row.quantity) || Number(row.quantity) > 100)
      return null;
    total += amount * Number(row.quantity);
    if (!Number.isSafeInteger(total) || total > 2147483647) return null;
  }
  return total;
}
export function ancillaryTotals(items: readonly NewOrderLineItem[], currency: string) {
  if (!items.length || items.length > MAX_LINE_ITEMS_PER_ORDER) return null;
  const maximum = majorToMinor(100000, currency);
  if (
    !items.every(
      (item) =>
        ANCILLARY_LINE_KINDS.some((kind) => kind === item.kind) &&
        !item.packageId &&
        item.description.trim().length > 0 &&
        item.description.length <= 200 &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 100 &&
        Number.isSafeInteger(item.unitAmountCents) &&
        item.unitAmountCents >= 0 &&
        item.unitAmountCents <= maximum,
    )
  )
    return null;
  const totalCents = items.reduce((sum, item) => sum + item.quantity * item.unitAmountCents, 0);
  const passThroughCents = items.reduce(
    (sum, item) =>
      sum + (item.kind === "pass_through_fee" ? item.quantity * item.unitAmountCents : 0),
    0,
  );
  return Number.isSafeInteger(totalCents) && totalCents <= 2147483647
    ? { totalCents, passThroughCents }
    : null;
}
export function ancillaryFingerprint(
  items: readonly Pick<NewOrderLineItem, "kind" | "description" | "quantity" | "unitAmountCents">[],
) {
  return JSON.stringify(
    items.map((item) => [item.kind, item.description, item.quantity, item.unitAmountCents]).sort(),
  );
}
