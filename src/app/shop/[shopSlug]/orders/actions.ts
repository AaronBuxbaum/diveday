"use server";

import { z } from "zod";
import { canPersonRefund } from "@/db/authz";
import { refundPaidAfterCloseCheckout } from "@/db/checkouts-paid-after-close";
import { getDb } from "@/db/client";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

const refundForm = z.object({ checkoutId: z.string().default("") });

const NOTICE_FOR = {
  refunded: "paid-after-close-refunded",
  not_owed: "paid-after-close-refunded",
  in_progress: "paid-after-close-in-progress",
  needs_reconciliation: "paid-after-close-needs-check",
  not_connected: "paid-after-close-not-connected",
  failed: "paid-after-close-failed",
} as const;

/**
 * Refund money a diver paid on a checkout DiveDay had already closed (issue
 * #2335), from the Orders index queue. Owner/manager work like every refund
 * (H-14), behind the money step-up; the checkout is read under the session's
 * own shop, never trusted from the form beyond its id. `not_owed` reads as
 * done: a second tap after the first went through has nothing left to send.
 */
export async function refundPaidAfterCloseAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders");
  if (!(await canPersonRefund(db, session.user.shopId, session.user.personId))) {
    revalidateAndRedirect(back, noticeUrl(back, "not-authorized-refund"));
    return;
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  const parsed = parseForm(refundForm, formData);
  const checkoutId = (parsed.ok && uuidParam(parsed.data.checkoutId)) || "";
  const outcome = checkoutId
    ? await refundPaidAfterCloseCheckout(db, session.user.shopId, checkoutId, session.user.personId)
    : ({ status: "failed" } as const);
  revalidateAndRedirect(back, noticeUrl(back, NOTICE_FOR[outcome.status]));
}
