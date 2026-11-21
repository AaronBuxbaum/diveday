import { randomUUID } from "node:crypto";
import { AddPanel } from "@/components/AddPanel";
import type { ShopSurface } from "@/features/accounts/session";
import { getPurchaseForm } from "@/features/money/recorded-purchases";
import { ORDER_COLLECTION_KEYS } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { currencyFractionDigits } from "@/lib/money";
import type { OrdersSearch } from "../_lib/orders-search";
import { purchasePanelHref } from "../_lib/purchase-panel-links";
import { PurchaseForm } from "./PurchaseForm";

export function PurchasePanel({
  open,
  surface,
  search,
  t,
  locale,
  personId,
}: {
  open: boolean;
  surface: Pick<ShopSurface, "db" | "shop" | "session">;
  search: OrdersSearch;
  t: StaffTranslator;
  locale: string;
  personId?: string;
}) {
  return (
    <AddPanel
      open={open}
      id="purchase"
      title={t("orders.purchase.title")}
      description={t("orders.purchase.explanation")}
      closeHref={purchasePanelHref(surface.shop.slug, search, false)}
      closeLabel={t("shared.addPanel.close")}
    >
      <PurchasePanelBody {...{ surface, t, locale, personId }} />
    </AddPanel>
  );
}
async function PurchasePanelBody({
  surface: { db, shop, session },
  t,
  locale,
  personId,
}: {
  surface: Pick<ShopSurface, "db" | "shop" | "session">;
  t: StaffTranslator;
  locale: string;
  personId?: string;
}) {
  const data = await getPurchaseForm(db, shop.id, session.user.personId, personId);
  if (!data) return null;
  const currency = data.currency;
  return (
    <PurchaseForm
      attemptId={randomUUID()}
      {...{ currency, locale }}
      step={currencyFractionDigits(currency) === 0 ? "1" : "0.01"}
      customer={data.customer}
      canCreateDue={data.canCreateDue}
      words={{
        title: t("orders.purchase.title"),
        entryType: t("orders.purchase.entryType"),
        received: t("orders.purchase.received"),
        due: t("orders.localDue.open"),
        dueHelp: t("orders.purchase.dueHelp"),
        itemsHeading: t("orders.purchase.itemsHeading"),
        paymentHeading: t("orders.purchase.paymentHeading"),
        totalInvalid: t("orders.purchase.totalInvalid"),
        submitDue: t("orders.localDue.submit"),
        payerRequired: t("orders.localDue.payerRequired"),
        customer: {
          label: t("orders.new.customerLabel"),
          placeholder: t("orders.purchase.walkInPlaceholder"),
          choose: t("orders.localDue.payerRequired"),
          change: t("orders.new.changeCustomer"),
          noMatches: t("orders.new.noCustomerMatches"),
          more: t("orders.new.moreCustomerMatches"),
        },
        method: t("orders.purchase.method"),
        reference: t("orders.purchase.reference"),
        note: t("orders.new.noteLabel"),
        optional: t("orders.new.noteHint"),
        item: t("orders.purchase.item"),
        kind: t("orders.new.lineItemKindLabel"),
        quantity: t("orders.new.quantityLabel"),
        price: t("orders.new.unitPriceLabel", { currency: currency.toUpperCase() }),
        tax: t("orders.purchase.tax"),
        taxHint: t("orders.purchase.taxHint"),
        tip: t("orders.purchase.tip"),
        gross: t("orders.purchase.gross"),
        grossDue: t("orders.localDue.gross"),
        add: t("orders.new.addItem"),
        remove: t("orders.new.removeItem"),
        submit: t("orders.purchase.submit"),
        busy: t("words.busy.recording"),
        invalid: t("orders.purchase.invalid"),
        methods: (["cash", "card_machine", "bank_transfer", "other"] as const).map((value) => ({
          value,
          label: t(ORDER_COLLECTION_KEYS[value]),
        })),
        kinds: (["merchandise", "rental", "other", "pass_through_fee"] as const).map((value) => ({
          value,
          label: t(`orders.new.kind.${value}`),
        })),
      }}
    />
  );
}
