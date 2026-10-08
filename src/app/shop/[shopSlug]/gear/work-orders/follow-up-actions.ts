"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageOrders } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  billWorkOrder,
  sendWorkOrderReadyNotice,
  setCustomerGearReminders,
} from "@/db/work-order-follow-up";
import { getWorkOrderDetail } from "@/db/work-orders";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { revalidateAndRedirect } from "@/lib/navigation";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { billLinesForWorkOrder } from "@/lib/work-order-follow-up";
import { workOrderQuantityInput } from "@/lib/work-orders";

/**
 * The bench's follow-up acts (ADR 20261008-work-order-follow-up): resend the
 * ready message, send the bill, and switch a piece's service reminders.
 *
 * Tenancy is the session's shop in every call, never a form field. The
 * automatic ready message is not here: it rides the status move itself
 * (`announceReady` in `./_lib/announce-ready.ts`).
 */

const orderSchema = z.object({ workOrderId: z.uuid() });

/** Send the ready message again, on a staffer's word. */
export async function resendReadyNoticeAction(formData: FormData) {
  const session = await requireStaffSession();
  const board = shopPath(session.user.shopSlug, "gear", "work-orders");
  const parsed = orderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));
  const landing = shopPath(session.user.shopSlug, "gear", "work-orders", parsed.data.workOrderId);

  const outcome = await sendWorkOrderReadyNotice(await getDb(), {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    resendByPersonId: session.user.personId,
  });
  const code = !outcome.ok
    ? outcome.reason === "not_ready"
      ? "ready-not-ready"
      : "not-found"
    : outcome.status === "sent"
      ? "ready-sent"
      : outcome.status === "no_contact"
        ? "ready-no-contact"
        : outcome.status === "not_configured"
          ? "ready-not-configured"
          : "ready-failed";
  revalidateAndRedirect(landing, noticeUrl(landing, code));
}

/**
 * **Send the bill.** Owner or manager work, behind the money step-up, exactly
 * like raising an order from Orders (H-14, ADR 20260803-invoicing-role-gate):
 * this *is* raising an order, built from the ticket's lines rather than typed.
 */
export async function sendWorkOrderBillAction(formData: FormData) {
  const session = await requireStaffSession();
  const board = shopPath(session.user.shopSlug, "gear", "work-orders");
  const parsed = orderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));
  const landing = shopPath(session.user.shopSlug, "gear", "work-orders", parsed.data.workOrderId);
  const db = await getDb();

  if (!(await canPersonManageOrders(db, session.user.shopId, session.user.personId))) {
    revalidateAndRedirect(landing, noticeUrl(landing, "bill-not-authorized"));
  }
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    redirect(stepUpChallengeUrl(session.user.shopSlug, "money", landing));
  }

  const shop = await getShopById(db, session.user.shopId);
  if (!shop) revalidateAndRedirect(landing, noticeUrl(landing, "not-found"));
  const detail = await getWorkOrderDetail(db, shop.id, parsed.data.workOrderId, {
    todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
  });
  if (!detail || detail.workOrder.deletedAt) {
    revalidateAndRedirect(landing, noticeUrl(landing, "not-found"));
  }

  // The words on the invoice are the shop's, in the shop's language: the
  // order freezes them (`NewOrderLineItem.description`).
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const lineItems = billLinesForWorkOrder(
    detail.lines.filter((line) => line.deletedAt === null),
  ).map(({ fractionalQuantityHundredths, ...line }) => ({
    ...line,
    // An hour and a half at the bench goes on as one line at its total, so the
    // quantity rides in the words where the customer can still read it.
    description:
      fractionalQuantityHundredths === null
        ? line.description
        : `${line.description} (${workOrderQuantityInput(fractionalQuantityHundredths)})`.slice(
            0,
            200,
          ),
  }));

  const outcome = await billWorkOrder(db, {
    shopId: shop.id,
    workOrderId: detail.workOrder.id,
    actorPersonId: session.user.personId,
    description: t("benchFollowUp.bill.description"),
    lineItems,
  });
  if (!outcome.ok) {
    const code = {
      not_found: "not-found",
      not_customer: "invalid",
      no_lines: "bill-no-lines",
      already_billed: "bill-already",
      not_authorized: "bill-not-authorized",
      not_connected: "bill-not-connected",
      invalid: "bill-invalid",
      tax_location_required: "bill-tax-location",
      stripe_failed: "bill-stripe-failed",
    }[outcome.reason];
    revalidateAndRedirect(landing, noticeUrl(landing, code));
  }
  // `createOrder` queued an `order.created` integration event; drain it after
  // this response, as Orders does (ADR 20260919-integration-delivery-is-write-driven).
  dispatchIntegrationsAfterResponse();
  revalidateAndRedirect(landing, noticeUrl(landing, "bill-sent"));
}

const remindersSchema = z.object({
  customerGearItemId: z.uuid(),
  personId: z.uuid(),
  on: z.enum(["true", "false"]),
});

/** Turn a customer piece's service reminders off, or back on, from the diver record. */
export async function setCustomerGearRemindersAction(formData: FormData) {
  const session = await requireStaffSession();
  const board = shopPath(session.user.shopSlug, "gear", "work-orders");
  const parsed = remindersSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));
  const back = shopPath(session.user.shopSlug, "divers", parsed.data.personId);
  const on = parsed.data.on === "true";
  const outcome = await setCustomerGearReminders(await getDb(), {
    shopId: session.user.shopId,
    customerGearItemId: parsed.data.customerGearItemId,
    on,
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    back,
    noticeUrl(back, outcome.ok ? (on ? "reminders-on" : "reminders-off") : "reminders-not-found"),
  );
}
