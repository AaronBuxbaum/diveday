import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { rentalFitProfiles } from "./schema";

/**
 * The fit book the front desk already keeps: sizes for the divers who have
 * been in before, so tomorrow's prep list is mostly filled in before anyone
 * asks. Deliberately partial — a real fit book always is, and the gaps are
 * what the departure board is complaining about.
 */
export async function seedRentalFit(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
): Promise<void> {
  const fits: Array<
    [
      number,
      {
        bcd: string | null;
        wetsuit: string | null;
        boot: string;
        fin: string;
        weights?: string;
        ownsRegulator?: boolean;
        needsStaffFit?: boolean;
      },
    ]
  > = [
    [0, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "6 kg" }],
    [1, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "8 kg" }],
    // A diver with their own reg — the prep list has to leave it off.
    [3, { bcd: "L", wetsuit: "M", boot: "10", fin: "M", ownsRegulator: true }],
    [4, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    // H-06 demo: the shop is out of this diver's size, so they're flagged for
    // hands-on fitting — their sizes are deliberately blanked on the prep list and they
    // get named in its "fit these divers at check-in" section instead.
    [7, { bcd: "XL", wetsuit: "XL", boot: "12", fin: "L", weights: "10 kg", needsStaffFit: true }],
    // Sizes half-recorded, which is how a fit book actually looks.
    [12, { bcd: null, wetsuit: "M", boot: "7", fin: "M" }],
    // The extended roster: the fit book a shop actually keeps after a few
    // seasons — most divers fully recorded, a few with their own regulator,
    // one more out-of-stock size, and a couple still half-filled in.
    [18, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "9 kg" }],
    [19, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "7 kg" }],
    [20, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "8 kg", ownsRegulator: true }],
    [21, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "5 kg" }],
    [24, { bcd: "M", wetsuit: "M", boot: "8", fin: "M", weights: "6 kg" }],
    [25, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "6 kg" }],
    [29, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    [31, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "6 kg" }],
    [33, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "9 kg", ownsRegulator: true }],
    [35, { bcd: "M", wetsuit: "M", boot: "8", fin: "M", weights: "6 kg" }],
    [40, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    // Another out-of-stock size — the second XL the prep list flags today.
    [
      42,
      { bcd: "XL", wetsuit: "XL", boot: "13", fin: "XL", weights: "11 kg", needsStaffFit: true },
    ],
    [44, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "5 kg" }],
    [46, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    [52, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "7 kg" }],
    [55, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    [61, { bcd: "M", wetsuit: "M", boot: "8", fin: "M", weights: "6 kg", ownsRegulator: true }],
    [63, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "9 kg" }],
    [64, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "6 kg" }],
    [70, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    [74, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "7 kg" }],
    [80, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    // Sizes half-recorded — a second version of the gap above.
    [26, { bcd: "M", wetsuit: null, boot: "8", fin: "M" }],
    [59, { bcd: null, wetsuit: "S", boot: "6", fin: "S" }],
  ];
  const profiles = fits
    .map(([index, fit]) => {
      const person = customers[index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        rentsBcd: true,
        rentsRegulator: !fit.ownsRegulator,
        rentsWetsuit: true,
        rentsMaskFins: true,
        rentsWeights: true,
        bcdSize: fit.bcd,
        wetsuitSize: fit.wetsuit,
        bootSize: fit.boot,
        finSize: fit.fin,
        weightPreference: fit.weights ?? null,
        // A seeded fit is a stated fit — without this every demo diver would
        // read as "nobody asked" on the packing list (schema.ts,
        // `rental_fit_profiles.fit_stated_at`).
        fitStatedAt: nowDate(),
        needsStaffFitAt: fit.needsStaffFit ? nowDate() : null,
        needsStaffFitNote: fit.needsStaffFit ? "No XL BCD left — fit from the spares" : null,
      };
    })
    .filter((row) => row !== null);
  if (profiles.length > 0) await db.insert(rentalFitProfiles).values(profiles);
}
