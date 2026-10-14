"use server";

import { getDb } from "@/db/client";
import { recordPaymentOnOpenOrder, voidCounterOrder } from "@/db/orders";
import { getShopById } from "@/db/shops";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { revalidateAndRedirect } from "@/lib/navigation";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { postedCollection, postedOrderId } from "./order-form";

/**
 * Void an order paid at the counter, to correct a mistake (ADR
 * 20261009-counter-payments). Local only: nothing reached Stripe, so there is
 * no demo guard. `voidCounterOrder` re-checks owner/manager against live roles
 * and refuses anything but a paid counter order; the page hides the control
 * from everyone else.
 */
export async function voidCounterAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
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
  if (outcome?.ok) dispatchIntegrationsAfterResponse();
  const notice = outcome?.ok
    ? "voided"
    : outcome?.reason === "not_authorized"
      ? "void-not-authorized"
      : "void-failed";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/**
 * **Record payment: cash / card machine** on an open invoice (fourth UX
 * review, item 19). Any active staff member, as any counter money is; behind
 * the money step-up, as Void is. `recordPaymentOnOpenOrder` re-checks staff,
 * the shop, the method and that the order is still an open invoice, and tells
 * Stripe first so the diver is not asked for the money again.
 *
 * Refused on a demo shop before any Stripe call: its invoices are made up, the
 * same reason Refresh and Void are (`actions.ts`).
 */
export async function recordPaymentAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
  const collection = postedCollection(formData);
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  if ((await getShopById(db, session.user.shopId))?.isDemo) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  const outcome =
    orderId && collection
      ? await recordPaymentOnOpenOrder(db, {
          shopId: session.user.shopId,
          orderId,
          actorPersonId: session.user.personId,
          collection,
        })
      : null;
  if (outcome?.ok) dispatchIntegrationsAfterResponse();
  const notice = outcome?.ok
    ? "payment-recorded"
    : outcome?.reason === "stripe_refused"
      ? "payment-stripe-refused"
      : "payment-record-failed";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}
