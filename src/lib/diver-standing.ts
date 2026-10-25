import type { CalendarDate } from "@/lib/calendar-date";
import type { DiverProfile } from "@/lib/diver-profile";
import { bookingIsAhead } from "@/lib/diver-status";
import { mergeShopHistory, priorVisitStanding } from "@/lib/prior-visits";

/**
 * **Who this person is to the shop, in one line** (fifth-loop ideas, item 36):
 * "23 dive days since Mar 2024 · last out Sep 30 · $2,140 spent · brought 2
 * friends", under the name on the diver record. Facts and counts; the header
 * words them.
 *
 * - **Dive days** are the milestone's, the recap's and Your days' unit
 *   (issue 2809): distinct days in the shop's zone, merged across the seats
 *   the database counts as numbered dive days (`numberedDiveDay()`, no
 *   cancelled seat, no-show, ride-along or held seat) that are no longer
 *   ahead, and imported visits that did not stand `did_not_happen`
 *   (`mergeShopHistory`).
 * - **Since** and **last out** are the first and last of those, on the shop's
 *   own calendar.
 * - **Spent** is money collected and kept, in the shop's currency only: an
 *   order counts what was paid less what was refunded; a booking with no order
 *   counts its payment row when it reads paid or deposit paid. A refunded or
 *   partly refunded booking-payment row counts nothing, because the row does
 *   not say how much stayed. Null unless the reader may see money
 *   (`canManageOrders`), and null at zero.
 */
export type DiverStanding = {
  diveDays: number;
  since: CalendarDate | null;
  lastOut: CalendarDate | null;
  spent: { cents: number; currency: string } | null;
  friends: number;
};

export function diverStanding(
  diver: DiverProfile,
  input: { now: Date; shop: { timezone: string; currency: string }; showMoney: boolean },
): DiverStanding {
  // Seats share `bookingIsAhead`'s late-arrival buffer, so the boat somebody
  // is still boarding is not counted as a day yet.
  const history = mergeShopHistory(
    diver.bookings.filter((entry) => entry.numberedDiveDay && !bookingIsAhead(entry, input.now)),
    diver.priorVisits.filter((visit) => priorVisitStanding(visit.statusLabel) !== "did_not_happen"),
    {
      bookingStartsAt: (entry) => entry.trip.startsAt,
      visitedOn: (visit) => visit.visitedOn,
      timezone: input.shop.timezone,
    },
  );
  const days: CalendarDate[] = [...new Set(history.map((entry) => entry.on))].sort();

  return {
    diveDays: days.length,
    since: days[0] ?? null,
    lastOut: days.at(-1) ?? null,
    spent: input.showMoney ? spentWithShop(diver, input.shop.currency) : null,
    friends: diver.friendsBrought,
  };
}

function spentWithShop(diver: DiverProfile, currency: string): DiverStanding["spent"] {
  let cents = 0;
  const ordered = new Set<string>();
  for (const { order } of diver.orders) {
    if (order.bookingId) ordered.add(order.bookingId);
    if (order.currency !== currency) continue;
    cents += Math.max(0, order.amountPaidCents - order.refundedCents);
  }
  for (const { booking, payment } of diver.bookingPayments) {
    if (ordered.has(booking.id) || payment.currency !== currency) continue;
    if (payment.status === "paid" || payment.status === "deposit_paid") {
      cents += payment.amountCents ?? 0;
    }
  }
  return cents > 0 ? { cents, currency } : null;
}
