import { randomUUID } from "node:crypto";
import { AddPanel } from "@/components/AddPanel";
import { getPurchaseForm } from "@/features/recorded-purchases";
import type { ShopSurface } from "@/features/session";
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
  const data = await getPurchaseForm(db, shop.id, session.user.personId);
  if (!data) return null;
  const currency = data.currency;
  return (
    <PurchaseForm
      attemptId={randomUUID()}
      {...{ currency, locale }}
      step={currencyFractionDigits(currency) === 0 ? "1" : "0.01"}
      customers={data.customers}
      personId={personId}
      words={{
        title: t("orders.purchase.title"),
        customer: t("orders.new.customerLabel"),
        choose: t("orders.new.chooseCustomer"),
        method: t("orders.purchase.method"),
        reference: t("orders.purchase.reference"),
        note: t("orders.new.noteLabel"),
        item: t("orders.purchase.item"),
        kind: t("orders.new.lineItemKindLabel"),
        quantity: t("orders.new.quantityLabel"),
        price: t("orders.new.unitPriceLabel", { currency: currency.toUpperCase() }),
        tax: t("orders.purchase.tax"),
        taxHint: t("orders.purchase.taxHint"),
        tip: t("orders.purchase.tip"),
        gross: t("orders.purchase.gross"),
        add: t("orders.new.addItem"),
        remove: t("orders.new.removeItem"),
        submit: t("orders.purchase.submit"),
        busy: t("words.busy.recording"),
        invalid: t("orders.purchase.invalid"),
        included: t("orders.purchase.included"),
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
