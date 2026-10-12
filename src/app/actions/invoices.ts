"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { resendOrderInvoice } from "@/db/orders";
import { trackEvent } from "@/lib/analytics";
import { parseForm } from "@/lib/form-parse";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { requireShopSurface } from "@/lib/session";
import type { InvoiceResendState } from "./invoice-resend-types";

const resendForm = z.object({ orderId: z.string().default("") });

/**
 * One-tap re-send of an already-invoiced Stripe payment from the Today queue,
 * so a `payment_due` row is a fix, not just a link to the roster. Only ever
 * resends an existing open invoice — never creates a new one, so a shop that
 * paused or disconnected Stripe can't be tricked into re-invoicing through a
 * stale form. Shop and order ownership are re-checked server-side on every
 * call; the caller only supplies an order id. Falls back to a plain form post
 * before hydration.
 */
export async function resendInvoiceAction(
  shopSlug: string,
  _prev: InvoiceResendState,
  formData: FormData,
): Promise<InvoiceResendState> {
  const session = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(resendForm, formData);
  const orderId = parsed.ok ? parsed.data.orderId : "";
  if (!orderId) return { status: "error", reason: "not_found" };
  // An invoice is an email to the diver; bound how many one staff member can
  // resend in an hour (`RATE_LIMITS.staffSendByActor`).
  const sendAllowed = await checkRateLimit(
    rateLimitKey("staff-send", "invoice", session.user.personId),
    RATE_LIMITS.staffSendByActor,
  );
  if (!sendAllowed.allowed) return { status: "error", reason: "rate_limited" };

  const outcome = await resendOrderInvoice(await getDb(), session.user.shopId, orderId);
  // Refresh Today so a resent invoice's row reflects the attempt.
  revalidatePath(`/shop/${shopSlug}`);

  if (outcome.status === "sent") {
    await trackEvent({ name: "staff_recovery", kind: "invoice_resent", surface: "today" });
    return { status: "sent" };
  }
  return { status: "error", reason: outcome.status };
}
