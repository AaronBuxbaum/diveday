"use server";

import { z } from "zod";
import { canPersonRefund } from "@/db/authz";
import { refundPaidAfterCloseCheckout } from "@/db/checkouts-paid-after-close";
import { getDb } from "@/db/client";
import { attributeUnattributedRefund } from "@/db/unattributed-refunds";
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
 * (H-20260724-staff-role-reach), behind the money step-up; the checkout is read under the session's
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

const matchForm = z.object({
  intentId: z.string().default(""),
  bookingId: z.string().default(""),
});

const MATCH_NOTICE_FOR = {
  matched: "stripe-refund-matched",
  partly: "stripe-refund-partly-matched",
  not_found: "stripe-refund-not-matched",
  not_on_checkout: "stripe-refund-not-matched",
  nothing_held: "stripe-refund-not-matched",
} as const;

/**
 * Say which seat a refund made in the Stripe dashboard on a party's checkout
 * was for (issue #2293), from the Orders index queue. Owner/manager work like
 * every refund (H-20260724-staff-role-reach), behind the money step-up; both ids are only handles,
 * read again under the session's own shop.
 */
export async function matchStripeRefundAction(formData: FormData) {
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
  const parsed = parseForm(matchForm, formData);
  const intentId = (parsed.ok && uuidParam(parsed.data.intentId)) || "";
  const bookingId = (parsed.ok && uuidParam(parsed.data.bookingId)) || "";
  const outcome =
    intentId && bookingId
      ? await attributeUnattributedRefund(db, {
          shopId: session.user.shopId,
          intentId,
          bookingId,
          actorPersonId: session.user.personId,
        })
      : ({ status: "not_found" } as const);
  const notice =
    outcome.status === "attributed"
      ? MATCH_NOTICE_FOR[outcome.remainingCents > 0 ? "partly" : "matched"]
      : MATCH_NOTICE_FOR[outcome.status];
  revalidateAndRedirect(back, noticeUrl(back, notice));
}
