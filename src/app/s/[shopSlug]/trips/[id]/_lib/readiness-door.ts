import { publicTripPath } from "@/lib/public-routes";

/**
 * **The door from the booked moment out to `/ready`.**
 *
 * The embed's short confirmation needs exactly one fact beyond the booking
 * itself: what mail went. Everything the old in-page confirmation read (the
 * payment panel, readiness, rental fit, the nitrox card, the party's claim
 * links) now belongs to `/ready`, which reads it on every visit rather than
 * only the one right after booking (ADR 20260820-one-page-after-booking).
 * Only say mail is on its way when it actually went — a party member booked
 * without an address of their own gets none — and mention the waiver only
 * when the confirmation carried one (UX review 2026-10-11, item 7;
 * `mailState`, read by `readTripPage`).
 *
 * The door out to `/ready` is a *path*, resolved by `../ready/route.ts` when
 * the diver taps it. This render mints no capability: a readiness token is
 * stored hashed and so cannot be read back, and minting a fresh one per
 * render both wrote a row per reload and — past
 * `MAX_LIVE_CAPABILITIES_PER_PURPOSE` — retired the readiness link `bookSpot`
 * had already emailed (`coderabbitai`).
 *
 * Always a real destination, which is the other half of what that costs: the
 * link used to be `href="#"` whenever no capability came back, and `#` under
 * `target="_top"` is not inert — a keyboard Enter replaced the shop's own
 * page with the embed route. `bookingToken` is a string wherever this
 * renders (`confirmed` exists only downstream of verifying it), and the empty
 * case lands on the departure's public page rather than nowhere.
 */
export function readinessDoorPath(
  shopSlug: string,
  tripId: string,
  bookingToken: string | undefined,
): string {
  return `${publicTripPath(shopSlug, tripId)}/ready?booking=${encodeURIComponent(bookingToken ?? "")}`;
}
