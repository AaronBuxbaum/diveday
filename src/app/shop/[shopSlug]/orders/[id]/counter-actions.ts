"use server";

import { getDb } from "@/db/client";
import {
  type RecordPaymentOnOrderOutcome,
  recordDemoPaymentOnOpenOrder,
  recordPaymentOnOpenOrder,
  voidCounterOrder,
} from "@/db/orders";
import { counterPaymentActivity, recordShopActivity } from "@/db/shop-activity";
import { getShopById } from "@/db/shops";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { revalidateAndRedirect } from "@/lib/navigation";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { recordPaymentNotice } from "./order-detail-keys";
import { postedCollection, postedOrderId, postedRoom } from "./order-form";

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
 * Stripe so the diver is not asked for the money again; the activity log
 * names who recorded it.
 *
 * **On a demo shop, cash and the card machine are recorded locally**
 * (market sheet 2026-10-22, item 6): its invoices are made up, so there is no
 * Stripe invoice to mark, and counter money never needed one.
 * `recordDemoPaymentOnOpenOrder` takes no Stripe provider and re-reads the
 * shop's demo flag in its own transaction. A room charge stays refused there,
 * as Refresh and Void are (`actions.ts`).
 */
export async function recordPaymentAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
  const collection = postedCollection(formData);
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  const demo = (await getShopById(db, session.user.shopId))?.isDemo === true;
  const counterMoney = collection === "cash" || collection === "card_machine" ? collection : null;
  if (demo && !counterMoney) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  let outcome: RecordPaymentOnOrderOutcome | null = null;
  if (orderId && demo && counterMoney) {
    outcome = demoOutcome(
      await recordDemoPaymentOnOpenOrder(db, {
        shopId: session.user.shopId,
        orderId,
        actorPersonId: session.user.personId,
        collection: counterMoney,
      }),
    );
  } else if (orderId && collection) {
    outcome = await recordPaymentOnOpenOrder(db, {
      shopId: session.user.shopId,
      orderId,
      actorPersonId: session.user.personId,
      collection,
      room: collection === "room_charge" ? postedRoom(formData) : null,
    });
  }
  if (outcome?.ok && collection) {
    // The money came over the counter (and, on a real shop, Stripe stops
    // collecting this invoice for good): the log names who recorded it.
    await recordShopActivity(db, {
      shopId: session.user.shopId,
      actorPersonId: session.user.personId,
      write: counterPaymentActivity(outcome.order.id, collection),
    });
    dispatchIntegrationsAfterResponse();
  }
  revalidateAndRedirect(back, noticeUrl(back, recordPaymentNotice(outcome, { demo })));
}

/** A demo write's refusal reads as any failed record: there is nothing in flight to wait on. */
function demoOutcome(
  outcome: Awaited<ReturnType<typeof recordDemoPaymentOnOpenOrder>>,
): RecordPaymentOnOrderOutcome {
  return outcome.ok ? outcome : { ok: false, reason: "invalid" };
}
