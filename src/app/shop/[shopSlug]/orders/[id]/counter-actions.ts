"use server";

import type { HeldTicket } from "@/components/SendHold";
import { getDb } from "@/db/client";
import { holdCounterPayment, pendingCounterPayment } from "@/db/counter-payment-hold";
import {
  type RecordPaymentOnOrderOutcome,
  recordPaymentOnOpenOrder,
  voidCounterOrder,
} from "@/db/orders";
import { counterPaymentActivity, recordShopActivity } from "@/db/shop-activity";
import { getShopById } from "@/db/shops";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { nowMs } from "@/lib/clock";
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
 * **Record payment: cash / card machine** (issue #3030, decided 2026-10-25:
 * one tap with an eight-second Undo hold, H-20260906-diveday-fill-already-knows). The tap holds the payment;
 * nothing is recorded until the hold runs out (`releaseHeldSendAction`, or the
 * hourly sweep for a screen that went elsewhere), and Undo leaves the order
 * as it was. Any active staff member, as any counter money is; behind the
 * money step-up, as Void is, asked here at the tap. A second tap on the same
 * order inside the hold is the same hold (`holdCounterPayment`).
 *
 * On a demo shop the release records locally (market sheet 2026-10-22, item
 * 6); on a real shop it tells Stripe so the diver is not asked again. Which
 * path runs is the shop row's call at record time, never the form's.
 */
export type HoldCounterPaymentResult =
  | { ok: true; ticket: HeldTicket; collection: "cash" | "card_machine" }
  | { ok: false; redirectTo: string };

export async function holdCounterPaymentAction(
  formData: FormData,
): Promise<HoldCounterPaymentResult> {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
  const collection = postedCollection(formData);
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  const failed = { ok: false, redirectTo: noticeUrl(back, "payment-record-failed") } as const;
  if (!orderId || (collection !== "cash" && collection !== "card_machine")) return failed;
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    return {
      ok: false,
      redirectTo: stepUpChallengeUrl(session.user.shopSlug, "money", back),
    };
  }
  const held = await holdCounterPayment(db, {
    shopId: session.user.shopId,
    orderId,
    actorPersonId: session.user.personId,
    collection,
  });
  if (!held) return failed;
  const pending = await pendingCounterPayment(db, session.user.shopId, orderId);
  // `holdMs` on the server's clock; the screen counts it down on its own
  // (see `HeldTicket`). A second tap gets what is left of the first hold.
  return {
    ok: true,
    ticket: {
      id: held.id,
      runAt: held.runAt.getTime(),
      holdMs: Math.max(0, held.runAt.getTime() - nowMs()),
    },
    // The way the hold carries, which a second tap does not change.
    collection: pending?.payload.collection ?? collection,
  };
}

/**
 * **Charge to room** (fifth-loop ideas, item 57): asks which room, so it is a
 * form with a confirm rather than a tap, and records at once. A demo shop has
 * no rooms to charge (its invoices are made up), so it is refused there, as
 * Refresh and Void are (`actions.ts`).
 */
export async function recordRoomChargeAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  const demo = (await getShopById(db, session.user.shopId))?.isDemo === true;
  if (demo) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  if (postedCollection(formData) !== "room_charge") {
    revalidateAndRedirect(back, noticeUrl(back, "payment-record-failed"));
    return;
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  const outcome: RecordPaymentOnOrderOutcome | null = orderId
    ? await recordPaymentOnOpenOrder(db, {
        shopId: session.user.shopId,
        orderId,
        actorPersonId: session.user.personId,
        collection: "room_charge",
        room: postedRoom(formData),
      })
    : null;
  if (outcome?.ok) {
    // The log names who recorded it, and Stripe stops collecting the invoice.
    await recordShopActivity(db, {
      shopId: session.user.shopId,
      actorPersonId: session.user.personId,
      write: counterPaymentActivity(outcome.order.id, "room_charge"),
    });
    dispatchIntegrationsAfterResponse();
  }
  revalidateAndRedirect(back, noticeUrl(back, recordPaymentNotice(outcome)));
}
