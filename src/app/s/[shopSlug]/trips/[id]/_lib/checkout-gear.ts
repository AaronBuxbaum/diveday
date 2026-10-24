import type { AppDb } from "@/db/client";
import { setBookingNitrox } from "@/db/nitrox";
import { recordPaidRentalKinds, saveRentalFit } from "@/db/rental-fit";
import { log } from "@/lib/log";
import {
  quoteRentalFit,
  type RentableItemKind,
  type RentalPricing,
  rentalFlagsFromKinds,
} from "@/lib/rentals";

/**
 * Persist each diver's chosen gear (and nitrox request) the moment their
 * booking exists — the same durable record `saveRentalFit`/`setBookingNitrox`
 * already write from the post-booking form, just written a step earlier. The
 * seats are already committed, so a write failure here is logged and dropped,
 * never turned into a booking error (docs ADR
 * 20260801-checkout-upsells-rental-gear).
 */
export async function persistCheckoutGear(
  dbi: AppDb,
  input: {
    shopId: string;
    bookings: ReadonlyArray<{ bookingId: string; personId: string; identityUnconfirmed: boolean }>;
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
    input.bookings.map(async ({ bookingId, personId, identityUnconfirmed }, index) => {
      const selection = input.selections[index];
      if (!selection) return;
      try {
        if (input.rentsAtCheckout) {
          // **A held seat writes nothing to the person it matched.** The row
          // is an existing diver's, reached by an email whose name on file
          // does not match (H-13), so whoever booked may not be them, and the
          // fit is theirs. A rented wetsuit ticked here would clear their
          // `dives_dry`, and with it the drysuit weight check on every later
          // trip (`security-reviewer`, layer 2). The paid gear still stands on
          // the order, and on the booking itself (`paid_rental_kinds`), where
          // prep racks it unsized and "Same person" can carry it to the fit;
          // the nitrox request below is this booking's own too. `/ready`
          // refuses a held seat's fit for the same reason.
          await recordPaidRentalKinds(dbi, {
            shopId: input.shopId,
            bookingId,
            kinds: selection.rentedKinds,
          });
          if (!identityUnconfirmed) {
            await saveRentalFit(dbi, {
              shopId: input.shopId,
              personId,
              ...rentalFlagsFromKinds(selection.rentedKinds),
            });
          }
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
