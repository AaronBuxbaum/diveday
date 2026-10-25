import Link from "next/link";
import { tapTargetLinkClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import type { departuresWithEmptySeats } from "@/lib/open-seats";

/** The emptiest departures named; the ledger below lists every one of the month's. */
const LISTED = 8;

/**
 * **Departures that left with empty seats** (issue #2424): the month's count
 * and the seats that never sold, each emptiest departure linked to its own
 * page, where the Details tab says why. Reports is where an owner looks for a
 * pattern; the close-out no longer carries it (UX review 2026-10-10, item 31).
 * A month where every boat filled, or none has sailed yet, renders nothing.
 */
export function EmptySeats({
  summary,
  shopSlug,
  t,
  locale,
  timeZone,
}: {
  summary: ReturnType<typeof departuresWithEmptySeats>;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  if (summary.departures === 0) return null;
  return (
    <section aria-labelledby="reports-empty-seats" className="mt-10">
      <h2 id="reports-empty-seats" className={SECTION_TITLE_CLASS}>
        {t("reports.emptySeats.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted tabular-nums">
        {t("reports.emptySeats.summary", {
          departures: summary.departures,
          seats: summary.seats,
        })}
      </p>
      <ul className="mt-3 text-sm">
        {summary.list.slice(0, LISTED).map((departure) => (
          <li
            key={departure.tripId}
            className="flex items-baseline justify-between gap-4 border-t border-border py-1 last:border-b"
          >
            <Link
              href={`/shop/${shopSlug}/trips/${departure.tripId}`}
              className={`${tapTargetLinkClass} text-base font-medium text-primary hover:underline`}
            >
              {t("reports.emptySeats.row", {
                title: departure.title,
                date: formatShortDate(departure.startsAt, locale, timeZone),
              })}
            </Link>
            <span className="tabular-nums">
              {t("reports.emptySeats.seats", { count: departure.openSeats })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
