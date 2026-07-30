import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import {
  type HistoryEntry,
  mergeShopHistory,
  priorVisitStanding,
  SHOP_HISTORY_PREVIEW_COUNT,
} from "@/lib/prior-visits";
import type { DiverProfile, Shop } from "./shared";

type Booking = DiverProfile["bookings"][number];
type PriorVisit = DiverProfile["priorVisits"][number];

/**
 * One line of a diver's history with the shop. Two kinds of row share the list
 * and must never read alike (ADR 20260725-import-prior-visits): a DiveDay
 * booking points at a trip this shop ran, and an imported row is a booking
 * record the previous system held — evidence a seat was reserved, not evidence
 * anyone got in the water. The imported row is marked, carries no link (there is
 * no trip here to open), and shows the old file's own status word and price
 * exactly as written.
 */
function HistoryRow({
  item,
  shop,
  locale,
  shopSlug,
  t,
}: {
  item: HistoryEntry<Booking, PriorVisit>;
  shop: Shop;
  locale: string;
  shopSlug: string;
  t: StaffTranslator;
}) {
  if (item.kind === "booking") {
    const { booking, trip, course } = item.entry;
    return (
      <li className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href={`/shop/${shopSlug}/trips/${trip.id}`}
            className="font-medium hover:text-primary hover:underline"
          >
            {trip.title}
          </Link>
          <p className="text-sm text-muted">
            {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
            {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
            {course ? ` · ${course.title}` : ""}
          </p>
        </div>
        <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
          {booking.status.replace("_", " ")}
        </span>
      </li>
    );
  }

  const visit = item.entry;
  const cancelled = priorVisitStanding(visit.statusLabel) === "did_not_happen";
  return (
    <li className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className={`font-medium ${cancelled ? "text-muted line-through" : ""}`}>
          {visit.title ?? t("divers.history.bookingFallback")}
        </p>
        <p className="text-sm text-muted">
          {formatCalendarDate(visit.visitedOn)}
          {visit.sourceLabel ? ` · ${visit.sourceLabel}` : ""}
          {/* Verbatim money from the old file — a label, never a number this app
              adds up (src/db/schema.ts, `prior_visits.amountLabel`). */}
          {visit.amountLabel ? ` · ${visit.amountLabel}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {visit.statusLabel ? (
          <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
            {visit.statusLabel}
          </span>
        ) : null}
        <Badge tone="neutral" size="sm">
          {t("divers.history.imported")}
        </Badge>
      </div>
    </li>
  );
}

function historyKey(item: HistoryEntry<Booking, PriorVisit>): string {
  return item.kind === "booking" ? `booking:${item.entry.booking.id}` : `visit:${item.entry.id}`;
}

export function ShopHistory({
  diver,
  shop,
  locale,
  shopSlug,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  shopSlug: string;
}) {
  const t = staffTranslator(locale);
  const history = mergeShopHistory(diver.bookings, diver.priorVisits, {
    bookingStartsAt: (booking) => booking.trip.startsAt,
    visitedOn: (visit) => visit.visitedOn,
    timezone: shop.timezone,
  });
  const imported = diver.priorVisits.length;
  // A long imported history would otherwise bury the cards and sizes a staffer
  // opened this page for; the older entries stay one click away, never dropped.
  const visible = history.slice(0, SHOP_HISTORY_PREVIEW_COUNT);
  const rest = history.slice(SHOP_HISTORY_PREVIEW_COUNT);

  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="history-heading">
      <h2 id="history-heading" className="text-lg font-semibold">
        {t("divers.history.heading")}
      </h2>
      {imported > 0 ? (
        <p className="mt-2 max-w-prose text-sm text-muted">
          {t("divers.history.importedVisitsText", { count: imported })}
        </p>
      ) : null}
      {history.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          {t("divers.history.noTripsYet")}
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {visible.map((item) => (
              <HistoryRow
                locale={locale}
                key={historyKey(item)}
                item={item}
                shop={shop}
                shopSlug={shopSlug}
                t={t}
              />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-primary hover:underline">
                {t("divers.history.showOlderEntries", { count: rest.length })}
              </summary>
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
                {rest.map((item) => (
                  <HistoryRow
                    locale={locale}
                    key={historyKey(item)}
                    item={item}
                    shop={shop}
                    shopSlug={shopSlug}
                    t={t}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
