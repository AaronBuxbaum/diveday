"use server";

import { getDb } from "@/db/client";
import { voidCounterOrder } from "@/db/orders";
import { revalidateAndRedirect } from "@/lib/navigation";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * Void an order paid at the counter, to correct a mistake (ADR
 * 20261009-counter-payments). Local only: nothing reached Stripe, so there is
 * no demo guard. `voidCounterOrder` re-checks owner/manager against live roles
 * and refuses anything but a paid counter order; the page hides the control
 * from everyone else.
 */
export async function voidCounterAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = uuidParam(String(formData.get("orderId") ?? "")) ?? "";
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  const outcome = orderId
    ? await voidCounterOrder(db, {
        shopId: session.user.shopId,
        orderId,
        actorPersonId: session.user.personId,
      })
    : null;
  const notice = outcome?.ok
    ? "voided"
    : outcome?.reason === "not_authorized"
      ? "void-not-authorized"
      : "void-failed";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}
