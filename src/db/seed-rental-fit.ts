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
        boot: string | null;
        fin: string | null;
        weights?: string;
        /**
         * **This diver is in a drysuit** (issue 1414). Its own size, on the
         * drysuit grid rather than the wetsuit's, and it turns `rents_wetsuit`
         * off with it: a diver who takes the shop's drysuit does not also take
         * its wetsuit, and a shop holds no wetsuit size for a piece it is not
         * handing them.
         *
         * The seed carried none until issue #1727, so the two rows a crew
         * reads about a drysuit diver on the morning of a departure had never
         * been rendered by a test or photographed: the sized drysuit piece with
         * no boots line beside it, and the weights line that deliberately shows
         * no number because a stated weighting is a wetsuit answer and a
         * drysuit needs two to four kilos more (`src/lib/dive-prep.ts`).
         */
        drysuit?: string;
        ownsRegulator?: boolean;
        /**
         * This diver brings the whole kit. Every `rents_*` column goes false,
         * and the sizes go with them — a shop does not hold a size for a piece
         * it never hands out.
         *
         * **Not the same as a row with no sizes**, which is why it needs a flag
         * of its own rather than five nulls: an unsized row means *nobody has
         * asked*, a state this file already seeds twice and the prep list
         * already renders differently. This one has been asked and answered.
         */
        ownsEverything?: boolean;
        needsStaffFit?: boolean;
      },
    ]
  > = [
    [0, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "6 kg" }],
    // **The drysuit diver** (issues 1414 and #1727). Tom Okafor: on today's reef
    // departure, so the prep list's drysuit and weight-check rows are on the
    // captured page; fully recorded otherwise, so his row says one thing and
    // not two; and named by no other seed or spec that reads his sizes, so this
    // moves the baselines it is about and no others. His stated weighting stays
    // on the record and is suppressed on the packing line, which is the whole
    // behaviour worth looking at.
    [1, { bcd: "L", wetsuit: null, boot: "11", fin: "L", weights: "8 kg", drysuit: "ML" }],
    // A diver with their own reg — the prep list has to leave it off.
    [3, { bcd: "L", wetsuit: "M", boot: "10", fin: "M", ownsRegulator: true }],
    [4, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    // A diver who brings all of it — most of a shop's repeat business, and
    // until now nobody in the demo. Their prep-list row reads "Own kit" with
    // nothing to pull, which is the answer a packer needs: a name with no
    // pieces beside it is settled, not a loose end. Ines is booked on today's
    // reef departure and is named by no other seed or spec, so this changes
    // exactly one row on one boat.
    [8, { bcd: null, wetsuit: null, boot: null, fin: null, ownsEverything: true }],
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
        rentsBcd: !fit.ownsEverything,
        rentsRegulator: !fit.ownsRegulator && !fit.ownsEverything,
        rentsWetsuit: !fit.ownsEverything && !fit.drysuit,
        rentsMaskFins: !fit.ownsEverything,
        rentsWeights: !fit.ownsEverything,
        rentsDrysuit: Boolean(fit.drysuit),
        bcdSize: fit.bcd,
        wetsuitSize: fit.wetsuit,
        drysuitSize: fit.drysuit ?? null,
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
