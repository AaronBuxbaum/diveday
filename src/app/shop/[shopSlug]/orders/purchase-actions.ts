"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import type { NewOrderLineItem } from "@/db/orders";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { revalidateAndRedirect } from "@/features/navigation";
import { recordPurchase, recordPurchaseRefund } from "@/features/recorded-purchases";
import { stepUpChallengeUrl } from "@/features/security-step-up";
import { requireStaffSession } from "@/features/session";
import { hasRequiredStepUp } from "@/features/step-up";
import { currencyFractionDigits, majorToMinor } from "@/lib/money";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { orderRowsFromForm } from "./_lib/order-form";

export type PurchaseActionState = { error: "invalid" | "not_authorized" | null };
const fields = z.object({
  attemptId: z.uuid(),
  personId: z.uuid(),
  currency: z.string().regex(/^[a-z]{3}$/),
  collection: z.enum(["cash", "card_machine", "bank_transfer", "other"]),
  receiptReference: z.string().trim().max(100),
  description: z.string().trim().max(200),
  tax: z.string(),
  tip: z.string(),
});

/** Exact decimal notation only: never silently round a counter receipt. */
function amount(value: string, currency: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  if ((value.split(".")[1]?.length ?? 0) > currencyFractionDigits(currency)) return null;
  const cents = majorToMinor(Number(value), currency);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 2_147_483_647 ? cents : null;
}

export async function recordPurchaseAction(
  _state: PurchaseActionState,
  form: FormData,
): Promise<PurchaseActionState> {
  const session = await requireStaffSession();
  const raw: Record<string, FormDataEntryValue> = {};
  for (const key of Object.keys(fields.shape)) {
    const values = form.getAll(key);
    if (values.length !== 1 || typeof values[0] !== "string") return { error: "invalid" };
    raw[key] = values[0];
  }
  const parsed = fields.safeParse(raw);
  const rows = orderRowsFromForm(form);
  if (!parsed.success || !rows?.length) return { error: "invalid" };
  const input = parsed.data;
  const lineItems: NewOrderLineItem[] = [];
  for (const row of rows) {
    if (
      !["merchandise", "rental", "other", "pass_through_fee"].includes(row.kind) ||
      !row.description.trim() ||
      row.description.trim().length > 200 ||
      !/^[1-9]\d*$/.test(row.quantity) ||
      Number(row.quantity) > 100
    )
      return { error: "invalid" };
    const cents = amount(row.unitAmount, input.currency);
    if (cents === null) return { error: "invalid" };
    lineItems.push({
      kind: row.kind as NewOrderLineItem["kind"],
      description: row.description.trim(),
      quantity: Number(row.quantity),
      unitAmountCents: cents,
    });
  }
  const taxCents = input.tax.trim() ? amount(input.tax.trim(), input.currency) : undefined;
  const tipCents = input.tip.trim() ? amount(input.tip.trim(), input.currency) : 0;
  if (taxCents === null || tipCents === null) return { error: "invalid" };
  const outcome = await recordPurchase(await getDb(), {
    ...input,
    shopId: session.user.shopId,
    createdByPersonId: session.user.personId,
    lineItems,
    taxCents,
    tipCents,
  });
  if (!outcome.ok) return { error: "invalid" };
  dispatchIntegrationsAfterResponse();
  const back = shopPath(session.user.shopSlug, "orders");
  revalidateAndRedirect(back, shopPath(session.user.shopSlug, "orders", outcome.order.id));
}

const refundFields = z.object({
  orderId: z.uuid(),
  attemptId: z.uuid(),
  expectedRefundedCents: z.coerce.number().int().nonnegative(),
  currency: z.string().regex(/^[a-z]{3}$/),
  amount: z.string(),
  reason: z.string().trim().min(1).max(200),
});
export async function recordPurchaseRefundAction(form: FormData) {
  const session = await requireStaffSession();
  const input = refundFields.safeParse(Object.fromEntries(form));
  const orders = shopPath(session.user.shopSlug, "orders");
  if (!input.success) revalidateAndRedirect(orders, noticeUrl(orders, "purchase-refund-invalid"));
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", input.data.orderId);
  if (!(await hasRequiredStepUp(db, session, "money")))
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  const cents = amount(input.data.amount, input.data.currency);
  const outcome =
    cents === null
      ? null
      : await recordPurchaseRefund(db, {
          ...input.data,
          shopId: session.user.shopId,
          actorPersonId: session.user.personId,
          amountCents: cents,
        });
  if (outcome?.ok) dispatchIntegrationsAfterResponse();
  revalidateAndRedirect(
    back,
    noticeUrl(back, outcome?.ok ? "purchase-refund-recorded" : "purchase-refund-invalid"),
  );
}
