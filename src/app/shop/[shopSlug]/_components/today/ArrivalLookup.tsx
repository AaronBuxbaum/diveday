import { Badge } from "@/components/ui/badge";
import { LedgerRow } from "@/components/ui/ledger";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { CheckInQueueRow } from "@/db/check-in";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatWeekdayTime } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { counterRowId } from "../../trips/[id]/check-in/focus";
import { ArrivalSearch } from "./ArrivalSearch";

/**
 * **Which boat is this diver on?** — Today's arrival lookup.
 *
 * The counter is each departure's own Check-in tab (ADR 20261001-logbook,
 * decision 3), which answers "who is still to come on *this* boat". The one
 * question it cannot answer is the desk's first one when a diver walks up with
 * a name and no idea which departure they booked, so that lookup lives here,
 * over the day: type a name, email, phone or scanned booking id, and each
 * match opens the boat's counter, where the tap that checks them in is.
 *
 * The rows are `listCheckInQueue` with the query — the counter's own arrivals
 * window and readiness, so a match here is exactly a row on that tab.
 */
export function ArrivalLookup({
  query,
  rows,
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  query: string;
  /** The counter queue for `query`, empty until something is typed. */
  rows: readonly CheckInQueueRow[];
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return (
    <section aria-label={t("shopHome.arrivals.label")} className="mb-10">
      <ArrivalSearch
        query={query}
        copy={{
          label: t("shopHome.arrivals.label"),
          placeholder: t("shopHome.arrivals.placeholder"),
        }}
      />
      {query ? (
        rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("shopHome.arrivals.none", { query })}</p>
        ) : (
          <div className="mt-4">
            <h2 className="sr-only">{t("shopHome.arrivals.resultsFor", { query })}</h2>
            <ul>
              {rows.map((row) => (
                <LedgerRow
                  key={row.bookingId}
                  href={`${shopPath(shopSlug, "trips", row.tripId, "check-in")}#${counterRowId(row.bookingId)}`}
                  linkLabel={t("shopHome.arrivals.open", {
                    name: row.personName,
                    trip: row.tripTitle,
                  })}
                  trailing={
                    row.bookingStatus === "checked_in" ? (
                      <Badge tone="success">{t("checkIn.row.arrived")}</Badge>
                    ) : row.bookingStatus === "no_show" ? (
                      <Badge tone="neutral">{t("checkIn.noShow.badge")}</Badge>
                    ) : (
                      <Badge tone={readinessStatusTone(row.readiness.status)}>
                        {readinessStatusText(t, row.readiness.status)}
                      </Badge>
                    )
                  }
                >
                  <div className="min-w-0">
                    <p className={`${SECTION_TITLE_CLASS} break-words`}>{row.personName}</p>
                    <p className="text-sm text-muted tabular-nums">
                      {formatWeekdayTime(row.startsAt, locale, timeZone)} · {row.tripTitle}
                    </p>
                  </div>
                </LedgerRow>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </section>
  );
}
