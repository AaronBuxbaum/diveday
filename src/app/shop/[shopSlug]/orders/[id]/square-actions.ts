"use server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireStaffSession } from "@/features/accounts/session";
import { parseForm, single } from "@/features/platform/form-parse";
import { revalidateWithNotice } from "@/features/platform/navigation";
import { linkSquareReceipt, releaseSquareReceipt } from "@/features/shop-setup/integrations";
import { shopPath } from "@/lib/staff-notices";

const form = z.object({
  orderId: single(z.uuid()),
  paymentId: single(z.string().trim().min(1).max(192)),
});
export async function linkSquareReceiptAction(formData: FormData): Promise<void> {
  const session = await requireStaffSession();
  const parsed = parseForm(form, formData);
  if (!parsed.ok) revalidateWithNotice(shopPath(session.user.shopSlug, "orders"), "invalid");
  const db = await getDb();
  const outcome = await linkSquareReceipt(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
    orderId: parsed.data.orderId,
    paymentId: parsed.data.paymentId,
  });
  revalidateWithNotice(
    shopPath(session.user.shopSlug, "orders", parsed.data.orderId),
    `square-${outcome}`,
  );
}

export async function releaseSquareReceiptAction(formData: FormData): Promise<void> {
  const session = await requireStaffSession();
  const parsed = parseForm(form, formData);
  if (!parsed.ok) revalidateWithNotice(shopPath(session.user.shopSlug, "orders"), "invalid");
  const db = await getDb();
  const released = await releaseSquareReceipt(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
    orderId: parsed.data.orderId,
    paymentId: parsed.data.paymentId,
  });
  revalidateWithNotice(
    shopPath(session.user.shopSlug, "orders", parsed.data.orderId),
    released ? "square-deleted" : "square-invalid",
  );
}
