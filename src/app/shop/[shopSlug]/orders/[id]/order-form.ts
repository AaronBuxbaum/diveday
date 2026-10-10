import { z } from "zod";
import { parseForm } from "@/lib/form-parse";
import { uuidParam } from "@/lib/uuid";

/**
 * Every money control on an order posts the order id; the refund adds what to
 * send back. Read through one parser (issue #2233), kept beside the route so
 * the route file stays its length.
 */
const orderForm = z.object({
  orderId: z.string().default(""),
  amountMajor: z.string().optional(),
});

/** The posted order id narrowed to a uuid, or "" — never a 500 on junk. */
export function postedOrderId(formData: FormData): string {
  const parsed = parseForm(orderForm, formData);
  return (parsed.ok && uuidParam(parsed.data.orderId)) || "";
}

/** The typed refund amount, trimmed; "" means the whole remaining balance. */
export function postedRefundAmount(formData: FormData): string {
  const parsed = parseForm(orderForm, formData);
  return (parsed.ok ? (parsed.data.amountMajor ?? "") : "").trim();
}
