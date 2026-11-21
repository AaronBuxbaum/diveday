import Link from "next/link";
import type { DbExecutor } from "@/db/client";
import { owesAnything, readOwed } from "@/features/money/owed";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { FACT_SEPARATOR } from "./notice-rows";

/**
 * **"Owed: $1,283 on 6 open orders, the oldest from Sep 18 · $95 on 1 seat
 * that sailed unpaid"** (fourth UX review, item 23). Filtered to Open, the
 * ledger listed six amounts and no total, and seats owing money with no order
 * behind them were on no money page at all. One quiet line answers "what are
 * we owed", and its orders half opens the Open filter across all dates.
 *
 * Renders nothing when nothing is owed: a calm ledger has no line about
 * money nobody is waiting on.
 *
 * The page mounts it for a Reports-grade reader only, the gate the Monday
 * email gives the same figure: its seats half is an aggregate no other crew
 * surface states (security review of layer r4-3).
 */
export async function OwedLine({
  db,
  shop,
  locale,
  t,
}: {
  db: DbExecutor;
  shop: { id: string; slug: string; currency: string; timezone: string };
  locale: string;
  t: StaffTranslator;
}) {
  const owed = await readOwed(db, shop, nowDate());
  if (!owesAnything(owed)) return null;
  const money = (cents: number) => formatMoneyCents(cents, owed.currency, locale);
  return (
    // One line from `sm`; on a phone the label and each sum take a line of
    // their own. Run together, the link's 44px box broke the line after
    // "Owed:" and left a "·" hanging at the end of it (`orders`).
    <div className="mb-6 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-x-1">
      <span className="font-medium">{t("orders.index.owed.label")}</span>
      {owed.orders.cents > 0 ? (
        <Link
          href={`/shop/${shop.slug}/orders?status=open&range=all`}
          className="flex min-h-11 items-center underline underline-offset-2 sm:inline-flex"
        >
          {t("orders.index.owed.orders", {
            amount: money(owed.orders.cents),
            count: owed.orders.count,
            date: owed.orders.oldestAt
              ? formatShortDate(owed.orders.oldestAt, locale, shop.timezone)
              : "",
          })}
        </Link>
      ) : null}
      {owed.orders.cents > 0 && owed.seats.cents > 0 ? (
        <span aria-hidden="true" className="max-sm:hidden">
          {FACT_SEPARATOR}
        </span>
      ) : null}
      {owed.seats.cents > 0 ? (
        <span className="block sm:inline">
          {t("orders.index.owed.seats", {
            amount: money(owed.seats.cents),
            count: owed.seats.count,
          })}
        </span>
      ) : null}
    </div>
  );
}
