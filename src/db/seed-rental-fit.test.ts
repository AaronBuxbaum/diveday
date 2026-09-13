import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, people, rentalFitProfiles, trips } from "./schema";
import { getTripPrep } from "./trips-prep";

/**
 * **The seeded fit book's one drysuit renter** (issues 1414 and #1727).
 *
 * `src/lib/dive-prep.test.ts` already pins what a drysuit does to a packing
 * list — one sized piece, no boots beside it, a weights line with no number and
 * fins the packer sizes up from. What no test held was that any seeded diver
 * rents one, so those four behaviours had never been rendered by an e2e run or
 * photographed by the visual suite: the assertions passed against fixtures and
 * the demo shop had nobody in a drysuit at all.
 *
 * This file is the tripwire for the seed, not for the rule: a later hand
 * tidying the fit book has to keep a drysuit diver on a departure the prep
 * captures reach, or say so here.
 */
describe("the seeded rental fit book", () => {
  it("puts exactly one diver in a drysuit, sized, and takes their wetsuit away with it", async () => {
    const { db, shop } = await seededShopContext({ history: true });

    const drysuitFits = await db
      .select({
        fullName: people.fullName,
        rentsDrysuit: rentalFitProfiles.rentsDrysuit,
        drysuitSize: rentalFitProfiles.drysuitSize,
        rentsWetsuit: rentalFitProfiles.rentsWetsuit,
        wetsuitSize: rentalFitProfiles.wetsuitSize,
        rentsWeights: rentalFitProfiles.rentsWeights,
        weightPreference: rentalFitProfiles.weightPreference,
      })
      .from(rentalFitProfiles)
      .innerJoin(people, eq(people.id, rentalFitProfiles.personId))
      .where(and(eq(rentalFitProfiles.shopId, shop.id), eq(rentalFitProfiles.rentsDrysuit, true)));

    expect(drysuitFits).toEqual([
      {
        fullName: "Tom Okafor",
        rentsDrysuit: true,
        drysuitSize: "ML",
        // A diver in the shop's drysuit is not also in its wetsuit, and a shop
        // holds no size for a piece it is not handing over.
        rentsWetsuit: false,
        wetsuitSize: null,
        // **The weighting stays on the record.** It is the stated answer to a
        // wetsuit question; the packing line is where it is withheld, and a
        // seed with no weighting at all would make that line right for the
        // wrong reason.
        rentsWeights: true,
        weightPreference: "8 kg",
      },
    ]);
  });

  /**
   * The reason the diver is Tom: the prep captures open today's reef
   * departure, so his row has to be on it or the two states this seeds go
   * unphotographed again.
   */
  it("seats that diver on the demo's next departure, where the prep captures look", async () => {
    const { db, shop } = await seededShopContext({ history: true });

    const [departure] = await db
      .select({ id: trips.id, title: trips.title })
      .from(trips)
      .innerJoin(bookings, eq(bookings.tripId, trips.id))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(trips.shopId, shop.id), eq(people.fullName, "Tom Okafor")))
      .orderBy(trips.startsAt)
      .limit(1);
    expect(departure?.title).toBe("Two-Tank Reef — Molasses & French");
    if (!departure) throw new Error("the drysuit diver is on no departure");

    // Through the page's own reader, so this is the checklist the capture
    // photographs rather than a fixture standing in for it.
    const prep = await getTripPrep(db, shop, departure.id);
    if (!prep) throw new Error("no prep for the drysuit diver's departure");
    const { lines, diverLines } = prep.checklist;

    // The sized drysuit piece, on the rack view and on the by-diver view.
    expect(lines.filter((line) => line.kind === "drysuit")).toMatchObject([
      { kind: "drysuit", size: "ML", count: 1, divers: ["Tom Okafor"] },
    ]);
    const dry = diverLines.find((row) => row.fullName === "Tom Okafor");
    if (!dry) throw new Error("the drysuit diver is not on the by-diver grouping");
    expect(dry.items.map((piece) => piece.kind)).toContain("drysuit");
    // No boots line beside it, and no wetsuit: most rental drysuits have their
    // boots vulcanised on, so the suit is the whole piece (issue 1414).
    expect(dry.items.map((piece) => piece.kind)).not.toContain("boots");
    expect(dry.items.map((piece) => piece.kind)).not.toContain("wetsuit");
    // The weights line with the number withheld, which is the row a crew reads
    // on the morning and nothing had ever drawn.
    expect(dry.items.find((piece) => piece.kind === "weights")).toMatchObject({
      size: null,
      drysuitWeightCheck: true,
    });
    // And the fins the packer sizes *up* from, flagged rather than blanked.
    expect(dry.items.find((piece) => piece.kind === "mask_fins")).toMatchObject({
      size: "L",
      drysuitFinFit: true,
    });
    // The seed's own claim: this diver still reads as a complete fit, so the
    // capture is not also photographing a new gap.
    expect(prep.checklist.diversWithIncompleteFit.map((row) => row.fullName)).not.toContain(
      "Tom Okafor",
    );
  });

  /**
   * The catalog and the fit have to agree, though not by the route this
   * docblock once claimed. A contradicted `rents_*` column is no longer
   * cleared by the next save of either fit form — the diver's answer was
   * theirs and a catalog edit is not the diver speaking, so the writer leaves
   * the flag alone (`ad4e182d1`, issue #1755). What the contradiction costs is
   * narrower: the piece is marked `notOffered` and may not change any other
   * line (`inShopDrysuit`, `src/lib/dive-prep.ts`).
   *
   * The seed still has to agree, for a different reason: a demo shop whose
   * drysuit renter it does not rent drysuits to photographs the contradiction
   * on every capture, and the seed is supposed to show the ordinary case.
   */
  it("offers drysuits in the shop's own catalog, so the fit is one a staffer could have saved", async () => {
    const { shop } = await seededShopContext();
    expect(shop.rentalItems).toContain("drysuit");
  });
});
