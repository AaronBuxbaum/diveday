import { randomUUID } from "node:crypto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { Order } from "@/db/schema";
import { ORDER_COLLECTION_KEYS } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { currencyFractionDigits } from "@/lib/money";
import { voidLocalOrderAction } from "../../local-order-actions";
import { LocalReceiptForm } from "./LocalReceiptForm";

export function LocalOrderControls({
  order,
  canManage,
  t,
}: {
  order: Order;
  canManage: boolean;
  t: StaffTranslator;
}) {
  if (order.collection !== "local_invoice" || order.status !== "open") return null;
  return (
    <section className="mt-6 border-t border-border pt-5">
      <h2 className="text-base font-semibold">{t("orders.localDue.open")}</h2>
      <p className="mt-2 text-sm text-muted">{t("orders.localDue.help")}</p>
      <LocalReceiptForm
        orderId={order.id}
        attemptId={randomUUID()}
        totalCents={order.totalCents}
        currency={order.currency}
        step={currencyFractionDigits(order.currency) === 0 ? "1" : "0.01"}
        words={{
          method: t("orders.localDue.method"),
          tax: t("orders.purchase.tax"),
          tip: t("orders.purchase.tip"),
          reference: t("orders.localDue.reference"),
          hint: t("orders.localDue.taxHint"),
          optional: t("orders.new.noteHint"),
          submit: t("orders.localDue.record"),
          busy: t("words.busy.recording"),
          invalid: t("orders.localDue.invalid"),
          methods: (["cash", "card_machine", "bank_transfer", "other"] as const).map((value) => ({
            value,
            label: t(ORDER_COLLECTION_KEYS[value]),
          })),
        }}
      />
      {canManage ? (
        <form action={voidLocalOrderAction} className="mt-4">
          <input type="hidden" name="orderId" value={order.id} />
          <SubmitButton
            pendingLabel={t("orders.detail.voiding")}
            className={buttonClass({ variant: "ghost" })}
          >
            {t("orders.localDue.void")}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
