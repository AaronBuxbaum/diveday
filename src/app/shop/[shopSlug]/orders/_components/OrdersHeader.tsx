import Link from "next/link";
import type { ReactNode } from "react";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { OrdersSearch } from "../_lib/orders-search";
import { purchasePanelHref } from "../_lib/purchase-panel-links";

/** Receipt recording stays available without Stripe; invoicing keeps its own gate. */
export function OrdersHeader({
  shopSlug,
  search,
  showInvoice,
  invoiceDoor,
  t,
}: {
  shopSlug: string;
  search: OrdersSearch;
  showInvoice: boolean;
  invoiceDoor: ReactNode;
  t: StaffTranslator;
}) {
  return (
    <ShopPageHeader
      title={t("shared.shopSections.money")}
      actions={
        <>
          <Link
            href={purchasePanelHref(shopSlug, search, true)}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("orders.purchase.title")}
          </Link>
          {showInvoice ? invoiceDoor : null}
        </>
      }
    />
  );
}

export function InvoiceDoor({ href, t }: { href: string | null; t: StaffTranslator }) {
  return href ? (
    <Link href={href} className={buttonClass()}>
      {t("orders.index.newOrder")}
    </Link>
  ) : null;
}
