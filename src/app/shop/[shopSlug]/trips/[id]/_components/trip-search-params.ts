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
  /** The deleted booking note's id, for its Undo. */
  noteId?: string;
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  /** `details` opens the Details tab; anything else is the Divers tab. */
  view?: string;
  /** A booking id: the page is that booking's paper pass, to print and hand over. */
  pass?: string;
  /** `1`: the page is the departure's packet, the sheets a captain prints and carries (#2736). */
  print?: string;
  /** `1`: the page is the departure's blow-out, the call-off confirmation or its record. */
  blowout?: string;
  /**
   * `1` opens the Divers tab with the cursor in its add band: where every
   * "Add a booking" door that knows the departure lands (#2737).
   */
  add?: string;
  /**
   * The date request the band seats from (`readSeatRequest`): its card, its
   * asker, and the id every seat posts. Kept in the URL while a party is
   * still being seated.
   */
  request?: string;
  /**
   * A diver id the add band preselects (`addBandFor`): where the no-show and
   * sailed rebook links land, so a namesake is never the one the desk picks.
   * Read by id in this shop; an unknown or already-aboard id is ignored.
   */
  person?: string;
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
  "add",
  "count",
  "form",
  "bid",
  "diverq",
  "person",
  "inviteq",
  "rf",
  "noteId",
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
