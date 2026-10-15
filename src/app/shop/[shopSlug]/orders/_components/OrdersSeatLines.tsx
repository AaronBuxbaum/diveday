import Link from "next/link";
import type { DbExecutor } from "@/db/client";
import { countShopOrders, type ShopOrderFilter } from "@/db/orders";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **What a departure's order list leaves out, and where it is** (issue #2550).
 * The trip pulse counts open orders on seats still on the boat, so the list it
 * opens reads the live seats too. An order left on a canceled seat may still
 * need a refund or a void, so it is never dropped: the live view carries one
 * link to those, and the canceled view one link back.
 */
export async function OrdersSeatLines({
  db,
  shopId,
  filter,
  seats,
  hrefFor,
  t,
}: {
  db: DbExecutor;
  shopId: string;
  /** The filter the list is read with, whose `seats` this swaps to count the other half. */
  filter: ShopOrderFilter;
  seats: "live" | "cancelled" | undefined;
  hrefFor: (seats: "live" | "cancelled") => string;
  t: StaffTranslator;
}) {
  if (!seats) return null;
  const other = seats === "cancelled" ? "live" : "cancelled";
  const count = await countShopOrders(db, shopId, { ...filter, seats: other });
  return (
    <>
      {seats === "cancelled" ? (
        <p className="mt-2 text-sm text-muted" data-testid="orders-cancelled-seats">
          {t("orders.index.cancelledSeatsOnly")}{" "}
          <Link href={hrefFor("live")} className="font-medium text-primary hover:underline">
            {t("orders.index.backToLiveSeats")}
          </Link>
        </p>
      ) : null}
      {count > 0 ? (
        <p className="mt-2 text-sm text-muted" data-testid="orders-other-seats">
          <Link href={hrefFor(other)} className="font-medium text-primary hover:underline">
            {seats === "cancelled"
              ? t("orders.index.liveSeatsLine", { count })
              : t("orders.index.cancelledSeatsLine", { count })}
          </Link>
        </p>
      ) : null}
    </>
  );
}
