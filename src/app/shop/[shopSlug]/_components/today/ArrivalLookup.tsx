import { Badge } from "@/components/ui/badge";
import { LedgerRow } from "@/components/ui/ledger";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import type { ArrivalElsewhere } from "@/db/arrival-elsewhere";
import type { CheckInQueueRow } from "@/db/check-in";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime, formatWeekdayTime } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { counterRowId } from "../../trips/[id]/_arrivals/focus";
import { ArrivalSearch } from "./ArrivalSearch";

/**
 * **Which boat is this diver on?** — Today's arrival lookup.
 *
 * The counter is each departure's own Divers tab once arrivals open (ADR
 * 20261001-logbook, decision 3, as amended 2026-10-05), which answers "who is still to come on *this* boat". The one
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
  elsewhere = [],
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  query: string;
  /** The counter queue for `query`, empty until something is typed. */
  rows: readonly CheckInQueueRow[];
  /**
   * The shop-wide answer when nobody arriving matches (`arrivalElsewhere`,
   * fifth loop, item 12): the people the query names and their next seat.
   */
  elsewhere?: readonly ArrivalElsewhere[];
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return (
    <section aria-labelledby="arrival-search-heading" className="mb-10">
      {/* The box's own name, said (fifth loop, item 12): the placeholder
          promised what the header search promises, and the label that says
          this one is about arrivals was a screen reader's alone. */}
      <h2 id="arrival-search-heading" className="mb-2 text-sm font-medium">
        {t("shopHome.arrivals.label")}
      </h2>
      <ArrivalSearch
        query={query}
        copy={{
          label: t("shopHome.arrivals.label"),
          placeholder: t("shopHome.arrivals.placeholder"),
        }}
      />
      {query ? (
        rows.length === 0 ? (
          elsewhere.length > 0 ? (
            // **Falls through to the shop** rather than to ⌘K: the person the
            // desk typed, and the seat they do have.
            <div className="mt-4" data-testid="arrival-elsewhere">
              <p className="text-sm text-muted">{t("shopHome.arrivals.notToday")}</p>
              <ul className="mt-2">
                {elsewhere.map((person) => (
                  <LedgerRow
                    key={person.personId}
                    href={shopPath(shopSlug, "divers", person.personId)}
                    linkLabel={t("shopHome.arrivals.openRecord", { name: person.fullName })}
                  >
                    <p className="min-w-0 text-sm tabular-nums">
                      {person.next
                        ? t("shopHome.arrivals.bookedOn", {
                            name: person.fullName,
                            date: formatShortDate(person.next.startsAt, locale, timeZone),
                            time: formatTime(person.next.startsAt, locale, timeZone),
                          })
                        : t("shopHome.arrivals.nothingBooked", { name: person.fullName })}
                    </p>
                  </LedgerRow>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">{t("shopHome.arrivals.none", { query })}</p>
          )
        ) : (
          <div className="mt-4">
            <h2 className="sr-only">{t("shopHome.arrivals.resultsFor", { query })}</h2>
            <ul>
              {rows.map((row) => (
                <LedgerRow
                  key={row.bookingId}
                  href={`${shopPath(shopSlug, "trips", row.tripId)}#${counterRowId(row.bookingId)}`}
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
                    <p className={`${ITEM_TITLE_CLASS} break-words`}>{row.personName}</p>
                    <p className="text-sm text-muted tabular-nums">
                      {formatWeekdayTime(row.startsAt, locale, timeZone)} · {row.tripTitle}
                    </p>
                    {row.runningLateAt ? (
                      <p className="text-sm font-medium text-warning-strong tabular-nums">
                        {t("checkIn.row.runningLate", {
                          time: formatTime(row.runningLateAt, locale, timeZone),
                        })}
                      </p>
                    ) : null}
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
