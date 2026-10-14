import Link from "next/link";
import type { DbExecutor } from "@/db/client";
import { owesAnything, readOwed } from "@/db/owed";
import type { StaffTranslator } from "@/i18n/staff-messages";
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
 */
export async function OwedLine({
  db,
  shop,
  now,
  shopSlug,
  locale,
  t,
}: {
  db: DbExecutor;
  shop: { id: string; currency: string; timezone: string };
  now: Date;
  shopSlug: string;
  locale: string;
  t: StaffTranslator;
}) {
  const owed = await readOwed(db, shop, now);
  if (!owesAnything(owed)) return null;
  const money = (cents: number) => formatMoneyCents(cents, owed.currency, locale);
  return (
    <p className="mb-6 text-sm">
      <span className="font-medium">{t("orders.index.owed.label")}</span>{" "}
      {owed.orders.cents > 0 ? (
        <Link
          href={`/shop/${shopSlug}/orders?status=open&range=all`}
          className="underline underline-offset-2"
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
      {owed.orders.cents > 0 && owed.seats.cents > 0 ? FACT_SEPARATOR : null}
      {owed.seats.cents > 0
        ? t("orders.index.owed.seats", { amount: money(owed.seats.cents), count: owed.seats.count })
        : null}
    </p>
  );
}
