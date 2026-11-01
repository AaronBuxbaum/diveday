import type { SailedRebooking } from "@/db/sailed-rebooking";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SalvageOffer } from "@/lib/no-show";
import { shopPath } from "@/lib/staff-notices";
import type { NoShowSalvageCopy } from "./NoShowScript";

/** Build salvage wording and links. The money line is descriptive and links to
 * the relevant order or seat action; it never charges or refunds.
 */
export function noShowSalvageCopy(input: {
  t: StaffTranslator;
  offer: SalvageOffer;
  shopSlug: string;
  tripId: string;
  /** Diver whose seat was released and who is offered rebooking. */
  diver: { id: string; name: string; bookingId: string };
  /** The page holds the locale and the shop's zone; this holds neither. */
  formatWhen: (startsAt: Date) => string;
  /** Turn-away rebooking moves this diver's existing seat; it does not create
   * a second booking or issue a refund.
   */
  turnedAway?: boolean;
  /** The existing seat cannot be moved; link to its Remove action. */
  moveClosed?: boolean;
}): NoShowSalvageCopy {
  const { t, offer, shopSlug, tripId, diver } = input;
  if (input.turnedAway) {
    // Link to the existing seat's Move panel, or its row when Move is closed.
    const row = shopPath(shopSlug, "trips", tripId);
    const money = input.moveClosed
      ? {
          line: t("checkIn.turnAway.money"),
          href: `${row}#booking-${diver.bookingId}`,
          label: t("checkIn.turnAway.moneyRemoveDoor"),
        }
      : {
          line: t("checkIn.turnAway.money"),
          href: `${row}#move-booking-${diver.bookingId}`,
          label: t("checkIn.turnAway.moneyMoveDoor"),
        };
    if (offer.kind === "waitlist") {
      return {
        line: t("checkIn.noShow.waiting", { count: offer.count }),
        links: [
          {
            href: `/shop/${shopSlug}/trips/${tripId}#who-wants-in`,
            label: t("checkIn.noShow.waitingDoor"),
          },
        ],
        money,
      };
    }
    return { line: t("checkIn.turnAway.noWaitlist"), links: [], money };
  }
  const money = {
    line: t("checkIn.noShow.money"),
    href: `/shop/${shopSlug}/orders?personId=${encodeURIComponent(diver.id)}`,
    label: t("checkIn.noShow.moneyDoor"),
  };
  if (offer.kind === "waitlist") {
    return {
      // Keep the offer on the departure's existing wait-list control.
      line: t("checkIn.noShow.waiting", { count: offer.count }),
      links: [
        {
          href: `/shop/${shopSlug}/trips/${tripId}#who-wants-in`,
          label: t("checkIn.noShow.waitingDoor"),
        },
      ],
      money,
    };
  }
  if (offer.kind === "rebook") {
    return {
      line: t("checkIn.noShow.rebook", { name: diver.name }),
      links: offer.departures.map((departure) => ({
        href: `/shop/${shopSlug}/bookings/new/${departure.tripId}?diverq=${encodeURIComponent(diver.name)}`,
        label: t("checkIn.noShow.rebookDoor", {
          title: departure.title,
          when: input.formatWhen(departure.startsAt),
        }),
        // Sending an offer is distinct from seating the diver.
        offer: {
          tripId: departure.tripId,
          ariaLabel: t("checkIn.noShow.offerAriaLabel", {
            name: diver.name,
            title: departure.title,
            when: input.formatWhen(departure.startsAt),
          }),
        },
      })),
      offerCopy: {
        personId: diver.id,
        label: t("checkIn.noShow.offerSend"),
        pending: t("checkIn.noShow.offerSending"),
        sendFailed: t("checkIn.sendFailedButton"),
      },
      money,
    };
  }
  return { line: t("checkIn.noShow.nothing"), links: [], money };
}

/** The sailed list's rebooking line, worded (`SailedRebookLine`). */
export type SailedRebookCopy = {
  line: string;
  /** Present for an open day: seat them, or email them the day. */
  add?: { href: string; label: string; ariaLabel: string };
  offer?: {
    tripId: string;
    personId: string;
    label: string;
    ariaLabel: string;
    pending: string;
    sendFailed: string;
  };
};

/** Describe the diver's next departure and provide its seating and offer
 * actions when a seat is open.
 */
export function sailedRebookCopy(input: {
  t: StaffTranslator;
  next: SailedRebooking;
  shopSlug: string;
  diver: { id: string; name: string };
  formatWhen: (startsAt: Date) => string;
}): SailedRebookCopy {
  const { t, next, shopSlug, diver } = input;
  const when = input.formatWhen(next.startsAt);
  if (next.kind === "booked") return { line: t("checkIn.sailedRebook.booked", { when }) };
  return {
    line: t("checkIn.sailedRebook.open", { when, seats: next.seatsLeft }),
    add: {
      href: `/shop/${shopSlug}/bookings/new/${next.tripId}?diverq=${encodeURIComponent(diver.name)}`,
      label: t("checkIn.sailedRebook.add"),
      ariaLabel: t("checkIn.sailedRebook.addAriaLabel", {
        name: diver.name,
        title: next.title,
        when,
      }),
    },
    offer: {
      tripId: next.tripId,
      personId: diver.id,
      label: t("checkIn.noShow.offerSend"),
      ariaLabel: t("checkIn.noShow.offerAriaLabel", { name: diver.name, title: next.title, when }),
      pending: t("checkIn.noShow.offerSending"),
      sendFailed: t("checkIn.sendFailedButton"),
    },
  };
}
