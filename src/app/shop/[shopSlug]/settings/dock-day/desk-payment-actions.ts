"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { setShopDeskPayment } from "@/db/shops";
import { DESK_PAYMENTS } from "@/lib/desk-payment";
import { parseForm, single } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "../action-helpers";

/** One of the three codes, or "" (or nothing) for "Don't say". Anything else is refused. */
const deskPaymentForm = z.object({
  deskPayment: single(z.union([z.enum(DESK_PAYMENTS), z.literal("")]), ""),
});

/**
 * **How divers pay at the desk** (fifth-loop ideas, item 21): card, cash, or
 * both, said wherever a seat is due at the shop. "Don't say" clears it.
 */
export async function saveDeskPaymentAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "dock-day");
  await settingsBlock(session);
  const parsed = parseForm(deskPaymentForm, formData);
  if (!parsed.ok) revalidateAndRedirect(page, noticeUrl(page, "desk-payment-invalid"));
  await setShopDeskPayment(await getDb(), session.user.shopId, parsed.data.deskPayment || null);
  revalidateAndRedirect(page, noticeUrl(page, "desk-payment-saved"));
}
