import type { AppDb } from "@/db/client";
import { PAGE_SIZE } from "@/db/paging";
import { offsetUpcomingTripsWithCounts } from "@/db/trips";
import { bookingPageNumber } from "./record-query";

/** The picker pages eligible departures after excluding this diver's existing seats. */
export function loadBookingDepartures(
  db: AppDb,
  shopId: string,
  personId: string,
  page: string | string[] | undefined,
  now: Date,
) {
  return offsetUpcomingTripsWithCounts(db, shopId, {
    hasSpace: true,
    excludeBookedForPersonId: personId,
    includeDepartureBuffer: true,
    limit: PAGE_SIZE.section,
    page: bookingPageNumber(page),
    now,
  });
}
