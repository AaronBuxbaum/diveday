"use server";

import { canPersonRefund } from "@/db/authz";
import { getDb } from "@/db/client";
import { getOrder, refreshOrderStatus, refundOrder, voidOrder } from "@/db/orders";
import { getShopById } from "@/db/shops";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { majorToMinor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { postedOrderId, postedRefundAmount } from "./order-form";
import { afterOrderRefunded } from "./refund-activity";

/**
 * Demo shops carry seeded orders whose Stripe invoice ids are fabricated (the
 * demo never connects a real Stripe account). Refresh / void / refund all reach
 * out to Stripe with those ids and would error against live platform
 * credentials, so on a demo shop these actions are refused before any Stripe
 * call — and the buttons are rendered disabled to match (src/db/seed.ts).
 */
// i18n-exempt: scanner false positive — the copy scanner reads the `>` closing this generic as JSX and treats the rest of the signature as a text node; it is code, not copy.
async function isDemoShop(db: Awaited<ReturnType<typeof getDb>>, shopId: string): Promise<boolean> {
  const shop = await getShopById(db, shopId);
  return shop?.isDemo ?? false;
}

/**
 * Every action on this page narrows the posted `orderId` (`postedOrderId`).
 *
 * Postgres raises on a malformed uuid literal rather than returning no rows,
 * so a hand-posted `orderId=abc` was an unhandled **500** where each action's
 * own `not_found` refusal belongs two lines later — the same failure the
 * dynamic-segment guard (`scripts/check-uuid-segments.mjs`) exists to stop on
 * routes, on a surface that moves money. The sibling refund door in
 * diver record (`divers/[personId]/`) already did this; here the money action was
 * the outlier (issue #699 security review).
 */
export async function refreshAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  const updated = orderId ? await refreshOrderStatus(db, session.user.shopId, orderId) : null;
  // A refresh can settle the order to paid or refunded, which enqueues an
  // integration event; drain it now rather than at the next cron tick (ADR
  // 20260919-integration-delivery-is-write-driven).
  if (updated) dispatchIntegrationsAfterResponse();
  revalidateAndRedirect(back, noticeUrl(back, updated ? "refreshed" : "refresh-failed"));
}

export async function voidAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  const updated = orderId ? await voidOrder(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, noticeUrl(back, updated ? "voided" : "void-failed"));
}

export async function refundAction(formData: FormData) {
  const session = await requireStaffSession();
  const orderId = postedOrderId(formData);
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  // Money leaving the account is owner/manager work, re-checked against live
  // roles (H-14, ADR 20260724-role-authorization).
  if (!(await canPersonRefund(db, session.user.shopId, session.user.personId))) {
    revalidateAndRedirect(back, noticeUrl(back, "not-authorized"));
    return;
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    revalidateAndRedirect(back, stepUpChallengeUrl(session.user.shopSlug, "money", back));
  }
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  // **What to send back.** The field carries major units because that is what
  // a staffer types; the domain works in minor ones. An empty field means the
  // whole remaining balance, which is what this button did before it could do
  // anything else — so a shop that never touches the amount sees no change at
  // all (issue #699).
  //
  // **The currency comes off the order, never off the form.** `majorToMinor`
  // scales by that currency's own minor units — two digits for USD, none for
  // JPY, three for BHD — so a hand-posted `currency` would silently multiply
  // or divide what the staffer typed by a thousand. The order row is the only
  // thing that knows what it was charged in, and it is read here under the
  // session's own `shopId` rather than accepted from the request.
  //
  // The typed figure is a *request*, never a bound: `refundOrder` re-reads the
  // order under its own `FOR UPDATE` lock and refuses anything above what that
  // row still holds, so the `max` on the input below is a convenience for the
  // person and nothing more. A hand-posted form gets `invalid_amount`.
  const typedAmount = postedRefundAmount(formData);
  const existing = orderId ? await getOrder(db, session.user.shopId, orderId) : null;
  if (typedAmount === null || (typedAmount && !existing)) {
    revalidateAndRedirect(back, noticeUrl(back, "refund-invalid-amount"));
    return;
  }
  const requestedCents =
    typedAmount && existing
      ? majorToMinor(Number(typedAmount), existing.order.currency)
      : undefined;
  // A code, never a sentence — `refundOrder` says *why* it did not move money
  // and this picks the words (docs ADR 20260731-domain-layer-copy-leaks).
  // `in_progress` is its own notice on purpose: the honest answer to a
  // double-tapped button is "the first one is still running", not "it failed",
  // which would send staff back to press it again (PAY-L3).
  const outcome = orderId
    ? await refundOrder(db, session.user.shopId, orderId, undefined, {
        amountCents: requestedCents,
      })
    : ({ status: "not_found" } as const);
  const notice =
    outcome.status === "refunded"
      ? outcome.order.status === "partly_refunded"
        ? "partly-refunded"
        : "refunded"
      : outcome.status === "in_progress"
        ? "refund-in-progress"
        : outcome.status === "invalid_amount"
          ? "refund-invalid-amount"
          : // Stripe already moved money on an earlier attempt whose local
            // write never landed. Pressing again would reverse more, so this
            // says so and points at the stuck-operations panel instead.
            outcome.status === "needs_reconciliation"
            ? "refund-needs-reconciliation"
            : "refund-failed";
  // Only a refund that moved money is logged and drained (`./refund-activity`).
  if (outcome.status === "refunded") await afterOrderRefunded(db, session.user, orderId);
  revalidateAndRedirect(back, noticeUrl(back, notice));
}
