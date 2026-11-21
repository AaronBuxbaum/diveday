"use server";

import { z } from "zod";
import { canPersonRefund } from "@/db/authz";
import { getDb } from "@/db/client";
import type { NewOrderLineItem } from "@/db/orders";
import { stepUpChallengeUrl } from "@/features/accounts/security-step-up";
import { requireStaffSession } from "@/features/accounts/session";
import { hasRequiredStepUp } from "@/features/accounts/step-up";
import { createLocalOrder } from "@/features/money/local-orders";
import { recordPurchase, recordPurchaseRefund } from "@/features/money/recorded-purchases";
import { revalidateAndRedirect } from "@/features/platform/navigation";
import { dispatchIntegrationsAfterResponse } from "@/features/shop-setup/integrations";
import { purchaseAmount } from "@/lib/purchase-lines";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { orderRowsFromForm } from "./_lib/order-form";

export type PurchaseActionState = { error: "invalid" | "not_authorized" | null };
const fields = z.object({
  intent: z.enum(["received", "due"]),
  attemptId: z.uuid(),
  personId: z
    .union([z.uuid(), z.literal("walk-in")])
    .transform((value) => (value === "walk-in" ? null : value)),
  currency: z.string().regex(/^[a-z]{3}$/),
  collection: z.enum(["cash", "card_machine", "bank_transfer", "other", "local_invoice"]),
  receiptReference: z.string().trim().max(100),
  description: z.string().trim().max(200),
  tax: z.string(),
  tip: z.string(),
});

const amount = purchaseAmount;

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
  const db = await getDb();
  if ((input.intent === "due") !== (input.collection === "local_invoice"))
    return { error: "invalid" };
  const outcome =
    input.intent === "due"
      ? input.personId === null
        ? null
        : await createLocalOrder(db, {
            shopId: session.user.shopId,
            personId: input.personId,
            actorPersonId: session.user.personId,
            attemptId: input.attemptId,
            currency: input.currency,
            lineItems,
            description: input.description,
          })
      : input.collection === "local_invoice"
        ? null
        : await recordPurchase(db, {
            ...input,
            collection: input.collection,
            shopId: session.user.shopId,
            createdByPersonId: session.user.personId,
            lineItems,
            taxCents,
            tipCents,
          });
  if (!outcome?.ok) return { error: "invalid" };
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
  // Before the step-up: a crew member the store would refuse should not be
  // walked through a challenge, then told the form was invalid.
  if (!(await canPersonRefund(db, session.user.shopId, session.user.personId)))
    revalidateAndRedirect(back, noticeUrl(back, "not-authorized"));
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
