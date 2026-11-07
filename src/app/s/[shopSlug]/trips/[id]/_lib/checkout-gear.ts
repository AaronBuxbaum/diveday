import type { AppDb } from "@/db/client";
import { setBookingNitrox } from "@/db/nitrox";
import { recordPaidRentalKinds, recordRentalFit } from "@/db/rental-fit";
import { log } from "@/lib/log";
import {
  quoteRentalFit,
  type RentableItemKind,
  type RentalPricing,
  rentalFlagsFromKinds,
} from "@/lib/rentals";

/**
 * Persist each diver's chosen gear (and nitrox request) the moment their
 * booking exists — the same durable record `recordRentalFit`/`setBookingNitrox`
 * already write from the post-booking form, just written a step earlier. The
 * seats are already committed, so a write failure here is logged and dropped,
 * never turned into a booking error (docs ADR
 * 20260801-checkout-upsells-rental-gear).
 */
export async function persistCheckoutGear(
  dbi: AppDb,
  input: {
    shopId: string;
    bookings: ReadonlyArray<{ bookingId: string; personId: string }>;
    selections: ReadonlyArray<{ rentedKinds: RentableItemKind[]; wantsNitrox: boolean }>;
    /**
     * The form asked about rental gear. False on a course session whose fee
     * includes the gear (issue #2795): not asked, so not answered, and no fit
     * is written that `/ready` would then read as "rents nothing".
     */
    rentsAtCheckout: boolean;
    nitroxOffered: boolean;
  },
): Promise<void> {
  await Promise.all(
    input.bookings.map(async ({ bookingId, personId }, index) => {
      const selection = input.selections[index];
      if (!selection) return;
      try {
        if (input.rentsAtCheckout) {
          // The paid gear stands on the booking itself (`paid_rental_kinds`),
          // where prep racks it, and on the diver's fit. A public seat is
          // never held: a different name on a known address is its own record
          // (Aaron 2026-11-06), so the fit written is the booker's.
          await recordPaidRentalKinds(dbi, {
            shopId: input.shopId,
            bookingId,
            kinds: selection.rentedKinds,
          });
          await recordRentalFit(dbi, {
            shopId: input.shopId,
            personId,
            ...rentalFlagsFromKinds(selection.rentedKinds),
          });
        }
        if (input.nitroxOffered) {
          await setBookingNitrox(dbi, {
            shopId: input.shopId,
            bookingId,
            wantsNitrox: selection.wantsNitrox,
          });
        }
      } catch (error) {
        log("booking.rental_fit_save_failed", "error", {
          bookingId,
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
      }
    }),
  );
}

/**
 * One priced gear line per diver whose selection actually quotes to
 * something — an item the shop hasn't priced online never reaches here
 * (quoteRentalFit already leaves it off the subtotal), so it stays "settled
 * at the shop" exactly as the post-booking form describes it.
 *
 * Nitrox alone is a gas fill, not rental gear, so `describe` is told which
 * and the card statement says so (domain review of #2795: a student on a
 * gear-included course who ticks only nitrox).
 */
export function checkoutGearLines(input: {
  pricing: RentalPricing;
  offeredKinds: RentableItemKind[];
  plannedDives: number;
  bookings: ReadonlyArray<{ bookingId: string; personName: string }>;
  selections: ReadonlyArray<{ rentedKinds: RentableItemKind[]; wantsNitrox: boolean } | undefined>;
  describe: (nitroxOnly: boolean, personName: string) => string;
}): Array<{ bookingId: string; amountCents: number; description: string }> {
  return input.bookings.flatMap(({ bookingId, personName }, index) => {
    const selection = input.selections[index];
    if (!selection) return [];
    const quote = quoteRentalFit(input.pricing, {
      rentedKinds: selection.rentedKinds,
      offeredKinds: input.offeredKinds,
      wantsNitrox: selection.wantsNitrox,
      plannedDives: input.plannedDives,
    });
    if (quote.subtotalCents <= 0) return [];
    const nitroxOnly = quote.lines.every((line) => line.kind === "nitrox");
    return [
      {
        bookingId,
        amountCents: quote.subtotalCents,
        description: input.describe(nitroxOnly, personName),
      },
    ];
  });
}
