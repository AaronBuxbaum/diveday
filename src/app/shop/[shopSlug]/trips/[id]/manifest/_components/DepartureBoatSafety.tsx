import { departureBoatId, departureBoatSafety } from "@/db/boat-safety";
import type { DbExecutor } from "@/db/client";
import { boatSafetyNoticeText } from "@/i18n/boat-safety-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { boatSafetyNoticeIsUrgent } from "@/lib/boat-safety";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { BoatSafetyNotices } from "./BoatSafetyNotices";

/**
 * **The boat itself** (roadmap N-08, N-10), read and worded for the Boat tab:
 * everyone on the departure list against the hull's certificate, its papers,
 * and the safety kit assigned aboard it. The page passes the departure
 * checkpoint's head count whichever checkpoint is open — the certificate is
 * about who is booked to sail, not who is back yet.
 *
 * Its own server component so the route file carries one slot, not the read
 * and the wording (`check:page-length`).
 */
export async function DepartureBoatSafety({
  db,
  shop,
  tripId,
  passengersAboard,
  idPrefix,
  t,
}: {
  db: DbExecutor;
  shop: { id: string; timezone: string };
  tripId: string;
  passengersAboard: number;
  idPrefix?: string;
  t: StaffTranslator;
}) {
  const safety = await departureBoatSafety(db, shop.id, {
    boatId: await departureBoatId(db, shop.id, tripId),
    passengersAboard,
    todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
  });
  if (!safety) return null;
  return (
    <BoatSafetyNotices
      idPrefix={idPrefix}
      heading={t("boatSafety.heading", { boatName: safety.boatName })}
      lines={safety.notices.map((notice) => ({
        text: boatSafetyNoticeText(t, notice),
        urgent: boatSafetyNoticeIsUrgent(notice),
      }))}
    />
  );
}
