import type { DbExecutor } from "@/db/client";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { requestFirstHandLocale } from "@/i18n/request";

/** Records only the submitter's own locale after the booking is committed. */
export async function recordLeadBookerLocale(db: DbExecutor, bookingId: string) {
  const locale = await requestFirstHandLocale();
  await recordDiverOwnLocaleForBooking(db, { bookingId, locale });
  return locale;
}
