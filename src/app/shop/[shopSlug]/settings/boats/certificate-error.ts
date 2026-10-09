import type { StaffTranslator } from "@/i18n/staff-messages";

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

export function boatCertificateError(
  t: StaffTranslator,
  params: { notice?: string; boat?: string; capacity?: string; limit?: string; count?: string },
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
    return {
      boat,
      text: t("boats.departuresAboveCertificateError", { count: departures, limit }),
    };
  }
  return null;
}
