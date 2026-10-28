/**
 * What a departure's staff page reads off its URL. Kept beside the page rather
 * than inline in its signature, so the route file stays a page.
 */
export type TripPageSearchParams = {
  notice?: string;
  bid?: string;
  diverq?: string;
  inviteq?: string;
  count?: string;
  /** Which form on this page the notice answers — see `resolveTripNotice`. */
  form?: string;
  /** Signed, and verified against this route's own `id` — src/lib/trip-admission-gate.ts. */
  gate?: string | string[];
  rf?: string;
  noteBookingId?: string;
  noteBody?: string;
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  /** `details` opens the Details tab; anything else is the Divers tab. */
  view?: string;
  /**
   * A refused Paid mark's status, amount (in cents) and method, so the sheet
   * reopens holding them (issue #2607). Read through `readMarkRetry`, never raw.
   */
  markStatus?: string;
  markAmount?: string;
  markMethod?: string;
  /**
   * A party payment waiting to be confirmed (issue #2605): the lead's seat, the
   * amount in cents and the method. The page works the split out again from the
   * database; none of these is shown as typed.
   */
  partyLead?: string;
  partyAmount?: string;
  partyMethod?: string;
  /** The reschedule notice a retime held, and how many seats it tells. */
  held?: string;
  tell?: string;
};

/** Transient outcomes cleared after this route has shown them once. */
export const TRIP_FLASH_PARAMS = [
  "notice",
  "count",
  "form",
  "bid",
  "diverq",
  "inviteq",
  "rf",
  "noteBookingId",
  "noteBody",
  "confirmName",
  "confirmEmail",
  "confirmPhone",
] satisfies (keyof TripPageSearchParams)[];

/** Keep the selected form in the URL while a timing or meeting edit is held. */
export function tripFlashParams({ held, form }: Pick<TripPageSearchParams, "held" | "form">) {
  return held && (form === "timing" || form === "meeting")
    ? TRIP_FLASH_PARAMS.filter((param) => param !== "form")
    : TRIP_FLASH_PARAMS;
}
