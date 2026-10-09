import type { StaffTranslator } from "@/i18n/staff-messages";
import { type CalendarDate, formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { cachedListFormat } from "@/lib/intl-cache";

/**
 * **The fleet row's certificate error** (H-107), read back off the redirect
 * `certificateRefusal` (settings/actions.ts) sends: which row it belongs on
 * and the sentence it says. Shared by the action and the page, so the two
 * agree on the codes and on the row's anchor.
 */

/** The fleet row's anchor; "new" is the add form. */
export function boatRowId(boat: string): string {
  return `boat-${boat}`;
}

export type BoatCertificateError = { boat: string; text: string };

/** A whole number from the query, or null: these arrive client-editable. */
function count(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * The departures' dates, as the redirect carried them (`2026-10-11,…`), joined
 * in the shop's language — or null when the list is missing or not dates.
 */
function datesList(raw: string | undefined, locale: string): string | null {
  if (!raw) return null;
  const dates = raw.split(",");
  if (dates.length > 3 || !dates.every((date) => isValidCalendarDate(date))) return null;
  return cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
    dates.map((date) => formatCalendarDate(date as CalendarDate, locale)),
  );
}

export function boatCertificateError(
  t: StaffTranslator,
  params: {
    notice?: string;
    boat?: string;
    capacity?: string;
    limit?: string;
    count?: string;
    dates?: string;
  },
  locale: string,
): BoatCertificateError | null {
  const boat = params.boat;
  const limit = count(params.limit);
  if (!boat || limit === null) return null;
  if (params.notice === "boat-above-certificate") {
    const capacity = count(params.capacity);
    if (capacity === null) return null;
    return { boat, text: t("boats.seatsAboveCertificateError", { capacity, limit }) };
  }
  if (params.notice === "boat-departures-above-certificate") {
    const departures = count(params.count);
    if (departures === null) return null;
    const dates = datesList(params.dates, locale);
    if (dates) {
      return {
        boat,
        text: t("boats.departuresAboveCertificateDatedError", { count: departures, limit, dates }),
      };
    }
    return {
      boat,
      text: t("boats.departuresAboveCertificateError", { count: departures, limit }),
    };
  }
  return null;
}
