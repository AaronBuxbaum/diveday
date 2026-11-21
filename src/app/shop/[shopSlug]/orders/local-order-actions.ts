"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { requireStaffSession } from "@/features/accounts/session";
import { recordLocalOrderReceipt, voidLocalOrder } from "@/features/money/local-orders";
import { revalidateAndRedirect } from "@/features/platform/navigation";
import { dispatchIntegrationsAfterResponse } from "@/features/shop-setup/integrations";
import { purchaseAmount } from "@/lib/purchase-lines";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { isUuid } from "@/lib/uuid";

export type LocalReceiptState = { error: "invalid" | null };
const receiptFields = z.object({
  orderId: z.uuid(),
  attemptId: z.uuid(),
  expectedTotalCents: z.coerce.number().int().positive(),
  currency: z.string().regex(/^[a-z]{3}$/),
  collection: z.enum(["cash", "card_machine", "bank_transfer", "other"]),
  tax: z.string(),
  tip: z.string(),
  receiptReference: z.string().trim().max(100),
});
export async function recordLocalReceiptAction(
  _state: LocalReceiptState,
  form: FormData,
): Promise<LocalReceiptState> {
  const session = await requireStaffSession();
  const raw: Record<string, FormDataEntryValue> = {};
  for (const key of Object.keys(receiptFields.shape)) {
    const values = form.getAll(key);
    if (values.length !== 1 || typeof values[0] !== "string") return { error: "invalid" };
    raw[key] = values[0];
  }
  const parsed = receiptFields.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const input = parsed.data;
  const taxCents = input.tax.trim() ? purchaseAmount(input.tax.trim(), input.currency) : undefined;
  const tipCents = input.tip.trim() ? purchaseAmount(input.tip.trim(), input.currency) : 0;
  if (taxCents === null || tipCents === null) return { error: "invalid" };
  const result = await recordLocalOrderReceipt(await getDb(), {
    ...input,
    shopId: session.user.shopId,
    actorPersonId: session.user.personId,
    taxCents,
    tipCents,
    receiptReference: input.receiptReference || null,
  });
  if (!result.ok) return { error: "invalid" };
  dispatchIntegrationsAfterResponse();
  const back = shopPath(session.user.shopSlug, "orders", input.orderId);
  revalidateAndRedirect(back, noticeUrl(back, "local-receipt-recorded"));
}
export async function voidLocalOrderAction(form: FormData) {
  const session = await requireStaffSession();
  const value = form.get("orderId");
  const index = shopPath(session.user.shopSlug, "orders");
  if (typeof value !== "string" || !isUuid(value))
    revalidateAndRedirect(index, noticeUrl(index, "local-order-invalid"));
  const back = shopPath(session.user.shopSlug, "orders", value);
  const result = await voidLocalOrder(await getDb(), {
    shopId: session.user.shopId,
    orderId: value,
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    back,
    noticeUrl(back, result.ok ? "local-order-voided" : "local-order-invalid"),
  );
}
