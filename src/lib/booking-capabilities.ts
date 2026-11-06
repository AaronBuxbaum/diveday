import { DAY_MS } from "@/lib/clock";

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

/** The absolute-path readiness link for an already-issued `readiness` capability token. */
export function readinessLinkPath(token: string): string {
  return `/ready/${token}`;
}

/**
 * The thread's Sign step, on the same `readiness` capability (ADR
 * 20261103-waiver-signs-in-the-thread): the seat's own release, which the
 * booking confirmation carries as its first step (issue #2743), so a diver
 * signing their own seat is never handed a second link.
 */
export function readinessWaiverLinkPath(token: string): string {
  return `${readinessLinkPath(token)}/waiver`;
}

/**
 * The course forms a student still owes, on the same `readiness` capability
 * (ADR 20261008-course-forms): the forms belong to the enrollment the token
 * already proves.
 */
export function courseFormsLinkPath(token: string): string {
  return `${readinessLinkPath(token)}/forms`;
}

/**
 * **A minor's seat whose address its party's lead typed** (issue #4003): a
 * seat the public party form made for someone the lead declared Under 18,
 * not yet claimed by its diver. That address cannot prove a guardian, so it
 * is sent no readiness link and no release link: the lead signs the release
 * on their own link, or the desk does with a guardian present. An adult
 * member's seat is never stamped (`createBookingParty`), nor is a seat staff
 * seated; claiming the seat ends it (`bookings.contact_typed_by_lead_at`).
 */
export function seatAddressIsLeadTyped(seat: {
  contactTypedByLeadAt: Date | null;
  claimedAt: Date | null;
}): boolean {
  return seat.contactTypedByLeadAt !== null && seat.claimedAt === null;
}

/** The absolute-path seat-claim link for an already-issued `claim` capability token. */
export function claimLinkPath(token: string): string {
  return `/claim/${token}`;
}
