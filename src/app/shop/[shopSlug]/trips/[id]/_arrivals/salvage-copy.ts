import type { SailedRebooking } from "@/db/sailed-rebooking";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SalvageOffer } from "@/lib/no-show";
import { shopPath } from "@/lib/staff-notices";
import type { NoShowSalvageCopy } from "./NoShowScript";

/**
 * **The salvage panel's words, once a staffer has written a diver off.**
 *
 * The precedence is `salvageOffer`'s (`src/lib/no-show.ts`) and this only picks
 * sentences for it — including the money one, which is a sentence and a link to
 * where that decision is made, never a charge or a refund control.
 *
 * **Each branch names who the offer is for**, which is the fix a
 * dive-domain-expert review asked for on 2026-09-11. The wait list is a buyer
 * for the freed seat. The second branch is not: a departure cannot take a seat
 * on another departure, so a list of other boats that "still have room",
 * sitting above the sentence saying the mark charges and refunds nothing, left
 * a staffer at a busy desk guessing whether it meant rebook the diver who just
 * missed or go and find a stranger. It means the first, so it says the first —
 * by name — and each link goes to the shipped seating door for that departure
 * with the diver already searched (`?diverq=`, the same hand-off the counter's
 * own walk-in link makes), rather than to another trip's staff page where
 * nothing about this diver is on screen.
 *
 * Extracted from the page because a rule about what the counter says is worth a test that does not need a database.
 */
export function noShowSalvageCopy(input: {
  t: StaffTranslator;
  offer: SalvageOffer;
  shopSlug: string;
  tripId: string;
  /** The released seat: a turned-away diver's money line links to its row. */
  bookingId: string;
  /** The diver the seat was taken from — the subject of the rebooking offer. */
  diver: { id: string; name: string };
  /** The page holds the locale and the shop's zone; this holds neither. */
  formatWhen: (startsAt: Date) => string;
  /**
   * The desk turned this diver away (H-135) rather than marking them not
   * here. Their next day is **their own booking moved** (`moveBooking` takes a
   * turned-away seat), so the panel names that door, on their row, and offers
   * no new booking: a second seat would charge them twice or spend a package
   * dive twice, and their orders hold no refund for a seat paid at checkout
   * (layer 3 review, dde-2 #3).
   */
  turnedAway?: boolean;
  /**
   * The turned-away seat cannot be moved: the boat's start has passed, or the
   * diver leads a party (dde-3 #4+#5, #7). The money line names Remove.
   */
  moveClosed?: boolean;
}): NoShowSalvageCopy {
  const { t, offer, shopSlug, tripId, diver } = input;
  if (input.turnedAway) {
    // A link to the door itself (#2907): the row's Move panel opens on its own
    // hash, and a seat that can no longer move opens the row, where Remove is.
    const row = shopPath(shopSlug, "trips", tripId);
    const money = input.moveClosed
      ? {
          line: t("checkIn.turnAway.money"),
          href: `${row}#booking-${input.bookingId}`,
          label: t("checkIn.turnAway.moneyRemoveDoor"),
        }
      : {
          line: t("checkIn.turnAway.money"),
          href: `${row}#move-booking-${input.bookingId}`,
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
      // The shipped offer control lives on the departure's Divers tab with its
      // held send, its undo window and its copyable fallback
      // (`WhoWantsInPanel.tsx`). The counter points at it rather than growing a
      // second sender beside it.
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
        // The same day, sent rather than seated (UX review 2026-10-11, item 14).
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

/**
 * **When the boat is home, the sailed list becomes the rebooking list**
 * (fifth-loop ideas, item 4): "Booked Sat 11:30 AM" for a diver already coming
 * back, which ends there, or "Nothing else booked · Thu 7:00 AM has 3 seats"
 * with the no-show salvage's two doors: the seating door with the diver
 * searched, and the same day emailed (`offerAnotherDayAction`).
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
