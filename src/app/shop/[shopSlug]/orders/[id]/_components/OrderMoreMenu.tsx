import Link from "next/link";
import { MoreMenu } from "@/components/MoreMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { menuRowClass } from "@/components/ui/menu";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { refreshAction, voidAction } from "../actions";

/**
 * **One overflow for the order's rare doors**: the dispute sheet and the
 * Stripe acts on an open invoice.
 * Record payment stays in the receipt card as the one row of work. A demo
 * shop sees Refresh and Void disabled, with the reason under them. Void asks
 * before it posts: it sits one row under Refresh and cannot be undone.
 */
export function OrderMoreMenu({
  t,
  shopSlug,
  orderId,
  canDisputeSheet,
  stripeOpen,
  demo,
}: {
  t: StaffTranslator;
  shopSlug: string;
  orderId: string;
  canDisputeSheet: boolean;
  /** An open Stripe invoice: the one state with Refresh and Void. */
  stripeOpen: boolean;
  demo: boolean;
}) {
  if (!canDisputeSheet && !stripeOpen) return null;
  return (
    <MoreMenu label={t("orders.detail.more")}>
      {canDisputeSheet ? (
        <Link
          href={shopPath(shopSlug, "orders", orderId, "print", "dispute")}
          // Opening the sheet writes a trail line, so a viewport prefetch must not open it.
          prefetch={false}
          className={menuRowClass("quiet", { gutter: false })}
        >
          {t("disputeSheet.door")}
        </Link>
      ) : null}
      {stripeOpen ? (
        demo ? (
          <>
            <button type="button" disabled className={menuRowClass("quiet", { gutter: false })}>
              {t("orders.detail.refreshStatus")}
            </button>
            <button type="button" disabled className={menuRowClass("danger", { gutter: false })}>
              {t("orders.detail.voidOrder")}
            </button>
            <p className="px-3 py-2 text-xs text-muted">{t("orders.detail.demoActionHint")}</p>
          </>
        ) : (
          <>
            <form action={refreshAction}>
              <input type="hidden" name="orderId" value={orderId} />
              <SubmitButton
                pendingLabel={t("orders.detail.refreshing")}
                className={menuRowClass("quiet", { gutter: false })}
              >
                {t("orders.detail.refreshStatus")}
              </SubmitButton>
            </form>
            <form action={voidAction}>
              <input type="hidden" name="orderId" value={orderId} />
              <SubmitButton
                pendingLabel={t("orders.detail.voiding")}
                // One row under Refresh in a menu: a void cannot be taken
                // back, so it asks first, as the inbox's Delete does.
                confirmMessage={t("orders.detail.voidConfirm")}
                className={menuRowClass("danger", { gutter: false })}
              >
                {t("orders.detail.voidOrder")}
              </SubmitButton>
            </form>
          </>
        )
      ) : null}
    </MoreMenu>
  );
}
