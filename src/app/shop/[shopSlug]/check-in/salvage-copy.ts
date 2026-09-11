import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SalvageOffer } from "@/lib/no-show";
import type { NoShowSalvageCopy } from "./_components/NoShowScript";

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
 * Extracted from the page for the reason `blocker-disclosure.ts` was: a rule
 * about what the counter says is worth a test that does not need a database.
 */
export function noShowSalvageCopy(input: {
  t: StaffTranslator;
  offer: SalvageOffer;
  shopSlug: string;
  tripId: string;
  /** The diver the seat was taken from — the subject of the rebooking offer. */
  diver: { id: string; name: string };
  /** The page holds the locale and the shop's zone; this holds neither. */
  formatWhen: (startsAt: Date) => string;
}): NoShowSalvageCopy {
  const { t, offer, shopSlug, tripId, diver } = input;
  const money = {
    line: t("checkIn.noShow.money"),
    href: `/shop/${shopSlug}/orders?personId=${encodeURIComponent(diver.id)}`,
    label: t("checkIn.noShow.moneyDoor"),
  };
  if (offer.kind === "waitlist") {
    return {
      // The shipped invite control lives on the departure's guest list with its
      // held send, its undo window and its copyable fallback
      // (`WaitlistSection.tsx`). The counter points at it rather than growing a
      // second sender beside it.
      line: t("checkIn.noShow.waiting", { count: offer.count }),
      links: [
        {
          href: `/shop/${shopSlug}/trips/${tripId}/guests`,
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
      })),
      money,
    };
  }
  return { line: t("checkIn.noShow.nothing"), links: [], money };
}
