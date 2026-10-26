import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FormStatus } from "@/components/ui/form";
import type { DbExecutor } from "@/db/client";
import type { CustomerGearNotice, WorkOrder } from "@/db/schema";
import { billAndPickupFacts } from "@/db/work-order-follow-up";
import {
  ORDER_COLLECTION_KEYS,
  ORDER_STATUS_KEYS,
  ORDER_STATUS_TONES,
  paidAtCounterLine,
} from "@/i18n/order-labels";
import { ownerOrManagerWords, type StaffWords, sayWords } from "@/i18n/shared-sentences";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { workOrderBillAllowsAnother } from "@/lib/work-order-follow-up";
import {
  recordBenchPaymentAction,
  resendReadyNoticeAction,
  sendWorkOrderBillAction,
} from "../follow-up-actions";

type CardNotice = { form: "ready" | "bill"; tone: NoticeTone } & StaffWords;

/** This card's own outcomes, answered beside the button that earned them. */
const NOTICES: Record<string, CardNotice> = {
  "ready-sent": { form: "ready", tone: "success", key: "benchFollowUp.notice.readySent" },
  "ready-no-contact": {
    form: "ready",
    tone: "warning",
    key: "benchFollowUp.notice.readyNoContact",
  },
  "ready-not-configured": {
    form: "ready",
    tone: "warning",
    key: "benchFollowUp.notice.readyNotConfigured",
  },
  "ready-failed": { form: "ready", tone: "danger", key: "benchFollowUp.notice.readyFailed" },
  "ready-not-ready": { form: "ready", tone: "warning", key: "benchFollowUp.notice.readyNotReady" },
  "bill-sent": { form: "bill", tone: "success", key: "benchFollowUp.notice.billSent" },
  "bill-paid-counter": {
    form: "bill",
    tone: "success",
    key: "benchFollowUp.notice.billPaidCounter",
  },
  "bill-already": { form: "bill", tone: "warning", key: "benchFollowUp.notice.billAlready" },
  "bill-no-lines": { form: "bill", tone: "danger", key: "benchFollowUp.notice.billNoLines" },
  "bill-not-connected": {
    form: "bill",
    tone: "danger",
    key: "benchFollowUp.notice.billNotConnected",
  },
  "bill-not-authorized": { form: "bill", tone: "danger", ...ownerOrManagerWords("bill") },
  "bill-invalid": { form: "bill", tone: "danger", key: "benchFollowUp.notice.billInvalid" },
  "bill-tax-location": {
    form: "bill",
    tone: "danger",
    key: "benchFollowUp.notice.billTaxLocation",
  },
  "bill-stripe-failed": {
    form: "bill",
    tone: "danger",
    key: "benchFollowUp.notice.billStripeFailed",
  },
};

function readyLine(
  notice: CustomerGearNotice,
  t: StaffTranslator,
  date: string,
): { text: string; tone: "neutral" | "warning" } {
  if (notice.status === "sent") {
    const key: StaffMessageKey =
      notice.channel === "sms"
        ? "benchFollowUp.ready.sentSms"
        : notice.channel === "whatsapp"
          ? "benchFollowUp.ready.sentWhatsapp"
          : "benchFollowUp.ready.sentEmail";
    return { text: t(key, { date }), tone: "neutral" };
  }
  if (notice.status === "no_contact") {
    return { text: t("benchFollowUp.ready.noContact"), tone: "warning" };
  }
  if (notice.status === "not_configured") {
    return { text: t("benchFollowUp.ready.notConfigured"), tone: "warning" };
  }
  return { text: t("benchFollowUp.ready.failed", { date }), tone: "warning" };
}

/**
 * **What the customer has heard, and what they owe** (ADR
 * 20261008-work-order-follow-up): the ready message and the bill, on a
 * customer's ticket only — a ticket on the shop's own unit has nobody to tell
 * and nobody to bill, so the card is not drawn.
 *
 * Reads its own facts rather than widening the ticket's detail read, so the
 * ticket page only mounts it.
 *
 * The bill is the Stripe order path, never a second one: Send the bill raises
 * one order from the parts and labor, an owner or manager only, and the card
 * then shows that order's own status. With no Stripe account connected there
 * is no button, only the total and where it is paid.
 */
export async function BillAndPickupCard({
  db,
  shop,
  workOrder,
  lineCount,
  totalCents,
  viewerPersonId,
  notice,
  locale,
  t,
}: {
  db: DbExecutor;
  shop: { id: string; slug: string; timezone: string; currency: string };
  workOrder: WorkOrder;
  lineCount: number;
  totalCents: number;
  viewerPersonId: string;
  /** The raw `?notice=` code; this card answers its own. */
  notice?: string;
  locale: string;
  t: StaffTranslator;
}) {
  if (!workOrder.personId || workOrder.deletedAt) return null;

  const { readyNotice, bill, connected, canBill, customerHasEmail } = await billAndPickupFacts(db, {
    shopId: shop.id,
    workOrderId: workOrder.id,
    personId: workOrder.personId,
    viewerPersonId,
  });
  const outcome = noticeFromParam(notice, NOTICES);
  const say = (form: CardNotice["form"]) =>
    outcome?.form === form ? (
      <FormStatus tone={outcome.tone} className="mt-3">
        {sayWords(t, outcome)}
      </FormStatus>
    ) : null;

  const isReady = workOrder.status === "ready";
  const ready = readyNotice
    ? readyLine(readyNotice, t, formatShortDate(readyNotice.createdAt, locale, shop.timezone))
    : null;
  const total = formatMoneyCents(totalCents, shop.currency, locale);
  const mayBillAgain = workOrderBillAllowsAnother(bill?.status ?? null);
  const showBill = lineCount > 0 || bill !== null;

  return (
    <SectionCard title={t("benchFollowUp.card.title")} padding="lg">
      <div className="space-y-8">
        {ready || workOrder.status !== "picked_up" ? (
          <section aria-labelledby="ready-message-heading">
            <h3 id="ready-message-heading" className="font-semibold">
              {t("benchFollowUp.ready.heading")}
            </h3>
            <p
              className={`mt-1 text-sm ${ready?.tone === "warning" ? "text-warning-strong" : "text-muted"}`}
            >
              {ready
                ? ready.text
                : isReady
                  ? t("benchFollowUp.ready.notSent")
                  : t("benchFollowUp.ready.pending")}
            </p>
            {isReady ? (
              <form action={resendReadyNoticeAction} className="mt-3">
                <input type="hidden" name="workOrderId" value={workOrder.id} />
                <SubmitButton
                  pendingLabel={t("benchFollowUp.ready.sending")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {readyNotice ? t("benchFollowUp.ready.resend") : t("benchFollowUp.ready.send")}
                </SubmitButton>
              </form>
            ) : null}
            {say("ready")}
          </section>
        ) : (
          say("ready")
        )}

        {showBill ? (
          <section aria-labelledby="bill-heading">
            <h3 id="bill-heading" className="font-semibold">
              {t("benchFollowUp.bill.heading")}
            </h3>
            <p className="mt-1 tabular-nums">{t("benchFollowUp.bill.total", { amount: total })}</p>
            {bill ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                <Badge tone={ORDER_STATUS_TONES[bill.status]}>
                  {t(ORDER_STATUS_KEYS[bill.status])}
                </Badge>
                <span>
                  {bill.collection === "stripe_invoice"
                    ? t("benchFollowUp.bill.sent", {
                        date: formatShortDate(bill.sentAt, locale, shop.timezone),
                      })
                    : paidAtCounterLine(t, {
                        collection: bill.collection,
                        date: formatShortDate(bill.sentAt, locale, shop.timezone),
                      })}
                </span>
                <Link
                  href={shopPath(shop.slug, "orders", bill.orderId)}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("benchFollowUp.bill.openOrder")}
                </Link>
              </p>
            ) : null}
            {/* **Paid at pickup** (fourth UX review, item 19): cash or the
                shop's card machine, recorded as the ticket's bill so it reads
                Paid here and reaches Reports' Gear bench line. Any staff, with
                or without Stripe; the line that stood here said "Collected at
                the counter." on an unpaid ticket, which read as paid. */}
            {!mayBillAgain || lineCount === 0 ? null : workOrder.status === "picked_up" ? (
              <details className="group mt-3" open={outcome?.form === "bill" || undefined}>
                <summary
                  className={buttonClass({
                    variant: "link",
                    size: "sm",
                    flush: true,
                    className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
                  })}
                >
                  {t("workOrders.detail.recordPayment")}
                  <DisclosureCaret direction="down" className="group-open:rotate-180" />
                </summary>
                <div className="mt-2">
                  <CounterPaymentControls workOrderId={workOrder.id} t={t} />
                </div>
              </details>
            ) : (
              <div className="mt-3">
                <CounterPaymentControls workOrderId={workOrder.id} t={t} />
              </div>
            )}
            {!mayBillAgain || lineCount === 0 || !connected ? null : !canBill ? (
              <p className="mt-2 text-sm text-muted">{t("benchFollowUp.bill.ownerOnly")}</p>
            ) : !customerHasEmail ? (
              <p className="mt-2 text-sm text-muted">{t("benchFollowUp.bill.needsEmail")}</p>
            ) : (
              <form action={sendWorkOrderBillAction} className="mt-3">
                <input type="hidden" name="workOrderId" value={workOrder.id} />
                <SubmitButton
                  pendingLabel={t("benchFollowUp.bill.sending")}
                  className={buttonClass({ size: "sm" })}
                >
                  {bill ? t("benchFollowUp.bill.sendAgain") : t("benchFollowUp.bill.send")}
                </SubmitButton>
              </form>
            )}
            {say("bill")}
          </section>
        ) : null}
      </div>
    </SectionCard>
  );
}

function CounterPaymentControls({ workOrderId, t }: { workOrderId: string; t: StaffTranslator }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{t("benchFollowUp.bill.paidAtPickup")}</span>
      {(["cash", "card_machine"] as const).map((collection) => (
        <form key={collection} action={recordBenchPaymentAction}>
          <input type="hidden" name="workOrderId" value={workOrderId} />
          <input type="hidden" name="collection" value={collection} />
          <SubmitButton
            pendingLabel={t("benchFollowUp.bill.recording")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t(ORDER_COLLECTION_KEYS[collection])}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}
