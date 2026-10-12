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
  /** The reschedule notice a retime held, and how many seats it tells. */
  held?: string;
  tell?: string;
};
