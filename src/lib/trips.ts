/**
 * Capacity math for trips. Kept framework-free so booking flows, manifests,
 * and the schedule UI all agree on what "full" means.
 */

/**
 * **The largest party one public booking can seat**, and why it is a number at
 * all.
 *
 * It was six, chosen with nothing written down (issue #725). Six suits a
 * family or a six-pack boat and is below several ordinary groups: a dive club
 * books eight or ten, a family is seven, a course cohort is a class. A group
 * that has to book twice does not become one group in two transactions — it
 * becomes **two unrelated parties**: two lead bookers, two
 * `party_lead_booking_id` chains, two seat-claim sets, two checkouts and two
 * refunds, with nothing in the data saying those people are together. The
 * manifest will not group them and the buddy-team builder does not know.
 *
 * The reason to be careful raising it is the **lock**, not the row count.
 * `createBookingRecord` opens with `SELECT ... FOR UPDATE` on the trip row and
 * `createBookingParty` loops every seat inside one transaction, so the first
 * seat takes that lock and the last releases it — every other booking on that
 * departure queues behind the whole party. A cap raised on a hunch is how a
 * Saturday-morning rush starts serialising.
 *
 * So it was measured, against a real Postgres, every seat declaring (the most
 * expensive per-seat write), on a departure sized exactly to the party so the
 * last seat always fills the boat — `createBookingParty — cost of an atomic
 * party` in `src/db/bookings.postgres.test.ts`, which prints these numbers on
 * every run of CI's `real-postgres` job:
 *
 *     6 seats  102ms  (17.0 ms/seat)
 *     12 seats 154ms  (12.9 ms/seat)
 *     20 seats 303ms  (15.2 ms/seat)
 *
 * Cost per seat is **flat** — the spread is noise, with no trend — so the work
 * in that loop is linear and a bound can be set against it. Twenty seats hold
 * the trip row for about a third of a second, which is the number that decides
 * this: it is a page load, not an outage, and the per-IP booking bucket
 * (`RATE_LIMITS.booking`, 10/hour) bounds how often anyone can spend it.
 *
 * **Twenty, because that is the largest party that was measured** — not
 * because twenty is a meaningful group size. Raising it further means running
 * that test again at the new size first; the flat per-seat cost predicts it
 * would hold, but a prediction is not a measurement.
 *
 * It stays **bounded**, whatever the number. A field that lets somebody type
 * 200 into a capacity transaction is a denial of service on a shop's Saturday.
 *
 * What this does **not** answer is what a group *is* — one payer for everyone
 * is usually wrong for a club, which splits. That is H-61 in
 * docs/product/human-decisions.md, and it is an owner's call.
 */
export const MAX_PUBLIC_PARTY_SIZE = 20;

export type TripCapacity = {
  capacity: number;
  /** Active (non-cancelled) bookings holding a spot. */
  booked: number;
};

export function spotsRemaining({ capacity, booked }: TripCapacity): number {
  return Math.max(0, capacity - booked);
}

export function isFull(trip: TripCapacity): boolean {
  return spotsRemaining(trip) === 0;
}

/**
 * A code, not a sentence (ADR 20260731-domain-layer-copy-leaks) — the domain
 * layer never picks the words. Callers render it through the `fallback.full`
 * / `fallback.spotsLeft` bundle keys (the diver and staff bundles both carry
 * them), which is what actually pluralizes and translates "3 spots left".
 */
export type CapacityLabel = { kind: "full" } | { kind: "left"; remaining: number };

export function capacityLabel(trip: TripCapacity): CapacityLabel {
  const remaining = spotsRemaining(trip);
  return remaining === 0 ? { kind: "full" } : { kind: "left", remaining };
}

/**
 * **The next boat out** — the soonest departure on the page a diver can still
 * get on, or `null` when every one of them is full, and when there is nothing
 * on the board at all.
 *
 * This was `pinnedNextDeparture`, which answered the same question but refused
 * to answer it whenever the agenda's own first row already had room: the pin
 * existed to surface a bookable departure *buried* behind full ones, and
 * restating the first row two hundred pixels above itself is the duplication
 * principle 9 forbids.
 *
 * ADR 20260827-clearwater-surface-language, decision 8, reverses that. The
 * storefront leads with the next boat **as a bookable object** — the page's one
 * card and its one primary action — so the card is the page's subject rather
 * than a notice about the list, and the week below keeps that same departure's
 * row, because a week with a hole where its first boat should be is not an
 * honest week. The card is a pin, not a removal.
 */
export function nextBookableDeparture<T extends TripCapacity & { id: string }>(
  upcoming: readonly T[],
): T | null {
  return upcoming.find((trip) => !isFull(trip)) ?? null;
}
