import { DAY_MS, HOUR_MS } from "@/lib/clock";
import { KIOSK_AHEAD_HOURS } from "@/lib/operational-window";
import { createBearerToken, hashBearerToken } from "./bearer-tokens";

/**
 * A booking capability (CR-002/CR-003) is anchored to the **trip**, not to the
 * moment it was minted: it stays valid until the trip ends plus a grace window
 * so post-trip follow-up (a late payment, a missed waiver, the recap that
 * lands after the boat is back) still works, and never expires sooner than a
 * day out even for a same-day booking.
 *
 * Deriving it from the trip is the whole point. A flat offset from issuance
 * (this was 60 days) quietly killed the confirmation URL and the readiness
 * link in the confirmation email for anyone who booked a season ahead — the
 * links were dead *before* the trip they were about.
 *
 * Still bounded, never unlimited: `CAPABILITY_MAX_TTL_MS` remains as an
 * absolute backstop so a mistyped departure date (a trip keyed to 2199)
 * cannot mint a lifetime credential. It sits far past any real booking lead
 * time, so it never truncates a legitimate one.
 */
export const CAPABILITY_MAX_TTL_MS = 2 * 365 * DAY_MS;
export const CAPABILITY_TRIP_GRACE_MS = 30 * DAY_MS;
export const CAPABILITY_MIN_TTL_MS = DAY_MS;

export const createCapabilityToken = createBearerToken;

export const hashCapabilityToken = hashBearerToken;

/**
 * `tripEndsAt + grace`, floored at `now + min` so it's never issued
 * dead-on-arrival and capped at `now + max` as a nonsense-date backstop.
 */
export function capabilityExpiryFor(tripEndsAt: Date, now: Date): Date {
  const tripBound = tripEndsAt.getTime() + CAPABILITY_TRIP_GRACE_MS;
  const ceiling = now.getTime() + CAPABILITY_MAX_TTL_MS;
  const floor = now.getTime() + CAPABILITY_MIN_TTL_MS;
  return new Date(Math.max(floor, Math.min(tripBound, ceiling)));
}

/**
 * **How long the code on a printed arrival card may open a counter.**
 *
 * The card is a file the diver saves, prints and can forward, so the credential
 * drawn into it is the one capability that leaves on paper. Under the
 * trip-anchored default above, a seat booked a season out printed a live bearer
 * credential for the season plus thirty days — a card left on a hotel table in
 * March still scanning in September (`security-reviewer`, issue #1600).
 *
 * Bounded to the morning it is for instead, off the *departure* rather than the
 * trip's end. The number is the kiosk's own {@link KIOSK_AHEAD_HOURS}, which is
 * exactly how early that tablet will look at a departure, so the credential can
 * never expire while the one door that accepts it is still open for this boat.
 * The cushion past `KIOSK_GRACE_MINUTES` is deliberate: "See the desk" should
 * be the kiosk's own answer about a departure that has sailed, never a dead
 * token's answer about a code.
 *
 * `issueBookingCapability` clamps this against the trip-anchored bound and
 * keeps whichever is sooner, so this can only ever shorten the life of a card.
 */
export function arrivalCardExpiryFor(tripStartsAt: Date): Date {
  return new Date(tripStartsAt.getTime() + KIOSK_AHEAD_HOURS * HOUR_MS);
}

/** The absolute-path readiness link for an already-issued `readiness` capability token. */
export function readinessLinkPath(token: string): string {
  return `/ready/${token}`;
}

/** The absolute-path seat-claim link for an already-issued `claim` capability token. */
export function claimLinkPath(token: string): string {
  return `/claim/${token}`;
}
