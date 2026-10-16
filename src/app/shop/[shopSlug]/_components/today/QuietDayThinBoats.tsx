import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { listThinBoats } from "@/db/thin-boats";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTime, formatWeekdayShortTime } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

/**
 * **A quiet day's list of boats that could use divers** (fifth-loop ideas,
 * item 43). With no boats today and nothing waiting, the next two weeks'
 * thin departures (`listThinBoats`), each with two doors: the departure's
 * last-minute deal, and its suggested past divers to invite one at a time
 * (item 44, H-130). Renders nothing when every boat is filling.
 */
export async function QuietDayThinBoats({
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  // Read here rather than handed down, so Today's page mounts nothing new: the
  // page has already proved this slug is the session's own shop.
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return null;
  const { shown, total } = await listThinBoats(db, shop.id, nowDate());
  if (shown.length === 0) return null;
  const door = buttonClass({ variant: "link", size: "sm", flush: true });
  return (
    <section aria-labelledby="thin-boats-heading" className="space-y-3" data-testid="thin-boats">
      <h2 id="thin-boats-heading" className="font-semibold">
        {t("shopHome.thinBoats.heading", { count: total })}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border">
        {shown.map((boat) => {
          const trip = shopPath(shopSlug, "trips", boat.tripId);
          return (
            <li key={boat.tripId} className="space-y-1 px-4 py-3">
              <p className="font-medium break-words">
                <Link href={trip} className="hover:underline">
                  {boat.title}
                </Link>
              </p>
              <p className="flex flex-wrap gap-x-2 text-sm text-muted tabular-nums">
                <span>
                  {formatShortDate(boat.startsAt, locale, timeZone)} ·{" "}
                  {formatTime(boat.startsAt, locale, timeZone)}
                </span>
                <span>
                  {t("shopHome.thinBoats.seats", { booked: boat.booked, capacity: boat.capacity })}
                </span>
                {boat.need.kind === "minimum" ? (
                  <span className="text-warning-strong">
                    {t("shopHome.thinBoats.needsBy", {
                      count: boat.need.shortfall,
                      when: formatWeekdayShortTime(boat.need.decidesAt, locale, timeZone),
                    })}
                  </span>
                ) : null}
              </p>
              <p className="flex flex-wrap gap-x-4">
                <Link href={`${trip}#last-minute-deal`} className={door}>
                  {t("shopHome.thinBoats.deal")}
                </Link>
                {boat.hasSite ? (
                  <Link href={`${trip}#invite-suggestions`} className={door}>
                    {t("shopHome.thinBoats.invite")}
                  </Link>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
