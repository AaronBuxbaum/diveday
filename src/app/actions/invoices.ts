"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { resendOrderInvoice } from "@/db/orders";
import { trackEvent } from "@/lib/analytics";
import { requireStaffSession } from "@/lib/session";
import type { InvoiceResendState } from "./invoice-resend-types";

/**
 * One-tap re-send of an already-invoiced Stripe payment from the Today queue,
 * so a `payment_due` row is a fix, not just a link to the roster. Only ever
 * resends an existing open invoice — never creates a new one, so a shop that
 * paused or disconnected Stripe can't be tricked into re-invoicing through a
 * stale form. Shop and order ownership are re-checked server-side on every
 * call; the caller only supplies an order id. Degrades to a plain form post
 * without JavaScript.
 */
export async function resendInvoiceAction(
  shopSlug: string,
  _prev: InvoiceResendState,
  formData: FormData,
): Promise<InvoiceResendState> {
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { status: "error", reason: "not_found" };

  const outcome = await resendOrderInvoice(await getDb(), session.user.shopId, orderId);
  // Refresh Today so a resent invoice's row reflects the attempt.
  revalidatePath(`/shop/${shopSlug}`);

  if (outcome.status === "sent") {
    await trackEvent({ name: "staff_recovery", kind: "invoice_resent", surface: "today" });
    return { status: "sent" };
  }
  return { status: "error", reason: outcome.status };
}
