import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rentalFitLine } from "@/lib/dive-prep";
import { NOTHING_RENTED, rentalFitCompleteness } from "@/lib/rentals";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createNitroxCertification, reviewNitroxCertification } from "./nitrox";
import {
  confirmRentalFitSize,
  fitConfirmationForDiver,
  getRentalFit,
  listTripPrepDivers,
  rentalFitByBooking,
  saveRentalFit,
  saveRentalFitNote,
  saveRentalFitSizes,
  setNeedsStaffFit,
  toDiverRentalFit,
} from "./rental-fit";
import { people, rentalFitProfiles } from "./schema";
import { setShopRentalItems } from "./shops";
import { upcomingTripsWithCounts } from "./trips";

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("open trip missing");
  return { db, shop, shopId: shop.id, tripId: open.id };
}

async function bookVisitor(db: AppDb, shopId: string, tripId: string, fullName: string) {
  const email = `${fullName.toLowerCase().replace(/\s+/g, ".")}@example.com`;
  const outcome = await createBooking(db, { actor: "staff", shopId, tripId, fullName, email });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, email)))
    .limit(1);
  if (!diver) throw new Error("diver missing");
  return { bookingId: outcome.bookingId, personId: diver.id };
}

function baseFitInput(shopId: string, personId: string) {
  return {
    shopId,
    personId,
    rentsBcd: true,
    rentsRegulator: false,
    rentsWetsuit: true,
    rentsMaskFins: true,
    rentsWeights: true,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHoodGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: "M",
    wetsuitSize: "3 mm / M",
    bootSize: "9",
    finSize: "M",
    weightPreference: "12 lbs",
  };
}

describe("saveRentalFit / getRentalFit", () => {
  it("creates a fit and reads it back", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    const saved = await saveRentalFit(db, { ...baseFitInput(shopId, personId), note: "Runs cold" });
    expect(saved).toMatchObject({ personId, shopId, bcdSize: "M", note: "Runs cold" });

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched).toMatchObject({ personId, bcdSize: "M", note: "Runs cold" });
  });

  it("upserts on a second save rather than duplicating the profile", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    const first = await saveRentalFit(db, baseFitInput(shopId, personId));
    const second = await saveRentalFit(db, { ...baseFitInput(shopId, personId), bcdSize: "L" });
    expect(second?.id).toBe(first?.id);

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched?.bcdSize).toBe("L");
  });

  it("preserves an existing note when the caller omits the note field", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    await saveRentalFit(db, {
      ...baseFitInput(shopId, personId),
      note: "Titanium hip, runs heavy",
    });
    // Staff correcting a boot size through a form that never carried the note field.
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), bootSize: "10" });

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched?.note).toBe("Titanium hip, runs heavy");
    expect(fetched?.bootSize).toBe("10");
  });

  it("leaves a size the caller never posted alone, and still clears one sent empty", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    await saveRentalFit(db, baseFitInput(shopId, personId));

    // A shop that has turned weights off in its rental catalog renders no
    // weight box, so its form posts no `weightPreference` key at all. The
    // save must go through, and must not blank what the diver already gave
    // -- re-adding the item would otherwise show an empty box (issue #1062).
    const { weightPreference: _dropped, ...withoutWeights } = baseFitInput(shopId, personId);
    const saved = await saveRentalFit(db, { ...withoutWeights, bcdSize: "L" });
    expect(saved).not.toBeNull();

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched?.weightPreference).toBe("12 lbs");
    expect(fetched?.bcdSize).toBe("L");

    // Absent and empty stay different answers: a box the shop *does* render,
    // emptied on purpose, is the diver taking the size back.
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), weightPreference: "  " });
    expect((await getRentalFit(db, shopId, personId))?.weightPreference).toBeNull();
  });

  it("clears the note when the caller explicitly sends an empty note", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    await saveRentalFit(db, { ...baseFitInput(shopId, personId), note: "Temporary note" });
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), note: "  " });

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched?.note).toBeNull();
  });

  it("refuses to write a fit for a person who belongs to a different shop", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    const saved = await saveRentalFit(db, {
      ...baseFitInput("99999999-8888-4777-8666-555555555555", personId),
    });
    expect(saved).toBeNull();
    // Nothing was written under the real shop either.
    expect(await getRentalFit(db, shopId, personId)).toBeNull();
  });

  /**
   * The drysuit size is the diver's own answer, so it has to survive the save
   * *and* the diver-facing projection — a column that stops at the boundary
   * would come back blank on the form that wrote it (issue 1414).
   */
  it("round-trips the drysuit size, including out to the diver's own projection", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    await saveRentalFit(db, {
      ...baseFitInput(shopId, personId),
      rentsDrysuit: true,
      drysuitSize: "  ML  ",
    });

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched?.drysuitSize).toBe("ML");
    expect(toDiverRentalFit(fetched)?.drysuitSize).toBe("ML");
  });

  it("leaves a stored drysuit size alone when the caller never posts one", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    await saveRentalFit(db, {
      ...baseFitInput(shopId, personId),
      rentsDrysuit: true,
      drysuitSize: "MT",
    });
    // A shop that has since dropped drysuits from its catalog posts no
    // `drysuitSize` key at all — the same rule every other size column keeps.
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), bcdSize: "L" });

    expect((await getRentalFit(db, shopId, personId))?.drysuitSize).toBe("MT");
  });

  it("returns null for a person with no fit on file", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    expect(await getRentalFit(db, shopId, personId)).toBeNull();
  });

  /**
   * **The other half of the absent-key rule** (issue #1755). The sizes have
   * been defended since issue #1062; the `rents_*` booleans were recomputed
   * from the post regardless, so a shop dropping an item from its catalog
   * turned its flag off on the next save of any diver's fit while the size was
   * preserved by the very defence protecting sizes. The piece left that diver's
   * packing list and the size sat behind it recording a fit nobody would act on.
   */
  describe("an item the shop no longer offers", () => {
    const withoutDrysuit = (items: readonly string[]) => items.filter((k) => k !== "drysuit");

    it("keeps the flag as well as the size when a form could not have asked", async () => {
      const { db, shop, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
      expect(shop.rentalItems).toContain("drysuit");

      await saveRentalFit(db, {
        ...baseFitInput(shopId, personId),
        rentsDrysuit: true,
        drysuitSize: "MT",
      });
      await setShopRentalItems(db, shopId, withoutDrysuit(shop.rentalItems));

      // What both fit forms post once the checkbox is gone: an unchecked HTML
      // checkbox and an absent one are the same empty post, so every caller
      // derives `false` from a question the form never put to the diver.
      await saveRentalFit(db, {
        ...baseFitInput(shopId, personId),
        rentsDrysuit: false,
        bcdSize: "L",
      });

      const fetched = await getRentalFit(db, shopId, personId);
      expect(fetched?.rentsDrysuit).toBe(true);
      expect(fetched?.drysuitSize).toBe("MT");
      expect(fetched?.bcdSize).toBe("L");
    });

    it("gives the diver their own answer back when the shop re-adds it", async () => {
      const { db, shop, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

      await saveRentalFit(db, {
        ...baseFitInput(shopId, personId),
        rentsDrysuit: true,
        drysuitSize: "MT",
      });
      await setShopRentalItems(db, shopId, withoutDrysuit(shop.rentalItems));
      await saveRentalFit(db, { ...baseFitInput(shopId, personId), rentsDrysuit: false });
      await setShopRentalItems(db, shopId, [...shop.rentalItems]);

      // Deliberate: it is still the diver's answer, nobody retracted it, and
      // the alternative is a shop's catalog edit speaking for a diver who was
      // never asked.
      const fetched = await getRentalFit(db, shopId, personId);
      expect(fetched?.rentsDrysuit).toBe(true);
      expect(fetched?.drysuitSize).toBe("MT");
    });

    it("still lets the diver untick a box the shop does offer", async () => {
      const { db, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

      await saveRentalFit(db, { ...baseFitInput(shopId, personId), rentsDrysuit: true });
      // The ordinary path, and the one a careless fix breaks: a flag that can
      // never be turned off is a worse bug than the one above.
      await saveRentalFit(db, { ...baseFitInput(shopId, personId), rentsDrysuit: false });

      const fetched = await getRentalFit(db, shopId, personId);
      expect(fetched?.rentsDrysuit).toBe(false);
      expect(fetched?.rentsRegulator).toBe(false);
      expect(fetched?.rentsBcd).toBe(true);
    });

    it("records no claim at all on a diver's first fit", async () => {
      const { db, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
      // A shop that rents wetsuits and nothing else. Five of the eleven columns
      // default to **true** in the schema, so "leave an unasked column alone"
      // on a brand-new row would put a BCD, a regulator, a mask, fins and
      // weights on this diver's packing list that nobody ever ticked.
      await setShopRentalItems(db, shopId, ["wetsuit"]);

      await saveRentalFit(db, { ...baseFitInput(shopId, personId), rentsBcd: true });

      const fetched = await getRentalFit(db, shopId, personId);
      expect(fetched?.rentsWetsuit).toBe(true);
      expect(fetched?.rentsBcd).toBe(false);
      expect(fetched?.rentsRegulator).toBe(false);
      expect(fetched?.rentsMaskFins).toBe(false);
      expect(fetched?.rentsWeights).toBe(false);
    });

    it("records no claim on a row that existed only for the diver's note", async () => {
      const { db, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
      await setShopRentalItems(db, shopId, ["wetsuit"]);
      // `saveRentalFitNote` creates the row with `fit_stated_at` null, so its
      // flags are still at the schema defaults and no answer has been given.
      await saveRentalFitNote(db, { shopId, personId, note: "Titanium hip, runs heavy" });

      await saveRentalFit(db, { ...baseFitInput(shopId, personId), rentsWetsuit: true });

      const fetched = await getRentalFit(db, shopId, personId);
      expect(fetched?.note).toBe("Titanium hip, runs heavy");
      expect(fetched?.rentsWetsuit).toBe(true);
      expect(fetched?.rentsBcd).toBe(false);
      expect(fetched?.rentsWeights).toBe(false);
    });

    it("refuses the save outright when the shop's catalog cannot be read", async () => {
      const { db, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
      // The state the reader defends against, and the only way a test can
      // build it: `people.shop_id` has a foreign key, so no app path can point
      // a diver at a shop with no row behind it. With the constraint off, the
      // catalog read comes back empty — and an empty *catalog* is a legitimate
      // answer ("this shop rents nothing"), which is exactly why an empty
      // *result* must not be read as one: what the writer would otherwise send
      // is eleven `false`s and a `fit_stated_at`, a fit claiming nothing on a
      // diver nobody asked (`dive-domain-expert` review).
      //
      // Without the refusal this does not fail quietly either — the same
      // missing row breaks `rental_fit_profiles_shop_id_shops_id_fkey` and the
      // caller gets an opaque database error where it already knows how to
      // render a null.
      const shopWithNoRow = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      await db.execute(sql`alter table people drop constraint people_shop_id_shops_id_fkey`);
      await db.update(people).set({ shopId: shopWithNoRow }).where(eq(people.id, personId));

      expect(
        await saveRentalFit(db, {
          ...baseFitInput(shopWithNoRow, personId),
          rentsBcd: true,
        }),
      ).toBeNull();
      const [profile] = await db
        .select()
        .from(rentalFitProfiles)
        .where(eq(rentalFitProfiles.personId, personId));
      expect(profile).toBeUndefined();
    });
  });
});

/**
 * The diver's own words to the crew, saved on their own. The note used to ride
 * along with the gear form's sizes and checkboxes; it is its own question on
 * `/ready` now (issue 627), so it needs a writer that touches nothing else —
 * a diver adding "titanium hip, I run heavy" must not blank the sizes they set
 * last week.
 */
describe("saveRentalFitNote", () => {
  it("writes a note for a diver with no fit on file yet", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    const saved = await saveRentalFitNote(db, { shopId, personId, note: "Titanium hip." });
    expect(saved).not.toBeNull();
    expect((await getRentalFit(db, shopId, personId))?.note).toBe("Titanium hip.");
  });

  it("does not state a fit, so a note-only diver packs nothing", async () => {
    // The bug this column exists to stop. Every `rents_*` column defaults to
    // **true**, so the row this writer creates would otherwise read as a diver
    // renting a BCD, regulator, wetsuit, boots, mask, fins and weights — seven
    // pieces, no sizes, none of them asked for — on the boat's packing list.
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    await saveRentalFitNote(db, { shopId, personId, note: "Bringing my own mask." });

    const fit = await getRentalFit(db, shopId, personId);
    expect(fit?.fitStatedAt).toBeNull();
    // Read exactly as a missing row is: nothing to pack from.
    expect(rentalFitLine(fit)).toEqual({ state: "not_recorded" });
  });

  it("leaves a stated fit stated when the note is rewritten", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    await saveRentalFit(db, baseFitInput(shopId, personId));

    await saveRentalFitNote(db, { shopId, personId, note: "Titanium hip." });

    const fit = await getRentalFit(db, shopId, personId);
    expect(fit?.fitStatedAt).not.toBeNull();
    expect(rentalFitLine(fit)).toMatchObject({ state: "rents" });
  });

  it("leaves every size and rental choice untouched", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), note: "First words" });

    await saveRentalFitNote(db, { shopId, personId, note: "Second words" });

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched?.note).toBe("Second words");
    expect(fetched?.bcdSize).toBe("M");
    expect(fetched?.wetsuitSize).toBe("3 mm / M");
    expect(fetched?.weightPreference).toBe("12 lbs");
    expect(fetched?.rentsBcd).toBe(true);
  });

  it("clears the note when the diver empties the box", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), note: "Temporary note" });

    await saveRentalFitNote(db, { shopId, personId, note: "  " });

    const fetched = await getRentalFit(db, shopId, personId);
    expect(fetched?.note).toBeNull();
    // ...and the fit itself survived the clearing.
    expect(fetched?.bcdSize).toBe("M");
  });

  it("refuses to write a note for a person who belongs to a different shop", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    const saved = await saveRentalFitNote(db, {
      shopId: "99999999-8888-4777-8666-555555555555",
      personId,
      note: "Not mine to write",
    });
    expect(saved).toBeNull();
    expect(await getRentalFit(db, shopId, personId)).toBeNull();
  });
});

/**
 * **The shelf's four sizes** — and the row it creates when the diver has no fit
 * on file, which is the ordinary case: the sizes form renders unconditionally
 * and the shelf has no checkbox to say what the diver rents.
 */
describe("saveRentalFitSizes", () => {
  it("states a fit that claims nothing, since the shelf never asked (#1755)", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Shelf Sheila");

    await saveRentalFitSizes(db, {
      shopId,
      personId,
      bcdSize: "M",
      wetsuitSize: "3mm/M",
      bootSize: "9",
      finSize: "M",
    });

    const fit = await getRentalFit(db, shopId, personId);
    // `fit_stated_at` is stamped here — four sizes typed by the diver are a
    // stated fit — and stamping it is what makes the five `default(true)`
    // columns readable by the packing list. So a diver correcting one size on
    // their own phone claimed a BCD, a regulator, a wetsuit, a mask, fins and
    // weights their shop may not even rent.
    expect(fit?.fitStatedAt).toBeInstanceOf(Date);
    expect(fit).toMatchObject(NOTHING_RENTED);
    expect(fit?.bcdSize).toBe("M");
  });

  it("leaves what the diver already said they rent exactly as it was", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Shelf Sheila");
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), rentsDrysuit: true });

    await saveRentalFitSizes(db, {
      shopId,
      personId,
      bcdSize: "L",
      wetsuitSize: "3mm/M",
      bootSize: "9",
      finSize: "M",
    });

    // The baseline is for the row this writer *creates*; an answer on file is
    // the diver's own and is never rewritten by a size correction.
    const fit = await getRentalFit(db, shopId, personId);
    expect(fit?.rentsBcd).toBe(true);
    expect(fit?.rentsDrysuit).toBe(true);
    expect(fit?.bcdSize).toBe("L");
  });

  it("states no claim for a diver who had only left the crew a note", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Shelf Sheila");
    // The row already exists with `fit_stated_at` null, so this writer takes
    // the update path and its own baseline never runs — the note writer's row
    // has to have been created claiming nothing for this to hold.
    await saveRentalFitNote(db, { shopId, personId, note: "Titanium hip, runs heavy" });

    await saveRentalFitSizes(db, {
      shopId,
      personId,
      bcdSize: "M",
      wetsuitSize: "3mm/M",
      bootSize: "9",
      finSize: "M",
    });

    const fit = await getRentalFit(db, shopId, personId);
    expect(fit?.note).toBe("Titanium hip, runs heavy");
    expect(fit).toMatchObject(NOTHING_RENTED);
  });
});

describe("setNeedsStaffFit (H-06 fallback)", () => {
  it("flags a diver with a note, then clears both on resolve", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Fit Fallback");
    await saveRentalFit(db, baseFitInput(shopId, personId));

    const flagged = await setNeedsStaffFit(db, {
      shopId,
      personId,
      needed: true,
      note: "No L BCD in stock",
    });
    expect(flagged?.needsStaffFitAt).toBeInstanceOf(Date);
    expect(flagged?.needsStaffFitNote).toBe("No L BCD in stock");

    const cleared = await setNeedsStaffFit(db, { shopId, personId, needed: false });
    expect(cleared?.needsStaffFitAt).toBeNull();
    // The stale note goes with the flag — it described a shortage that's over.
    expect(cleared?.needsStaffFitNote).toBeNull();
  });

  it("leaves the flag alone when the diver's sizes are edited", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Sticky Flag");
    await saveRentalFit(db, baseFitInput(shopId, personId));
    await setNeedsStaffFit(db, { shopId, personId, needed: true, note: "No L BCD" });

    // A stale flag costs one extra look; a silently-cleared one puts a diver in
    // gear nobody checked. Only the explicit clear above may take it down.
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), bcdSize: "S" });
    const after = await getRentalFit(db, shopId, personId);
    expect(after?.bcdSize).toBe("S");
    expect(after?.needsStaffFitAt).toBeInstanceOf(Date);
  });

  it("returns null for a diver with no fit on file to flag against", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "No Fit Yet");
    expect(await setNeedsStaffFit(db, { shopId, personId, needed: true })).toBeNull();
  });
});

/**
 * **Recall, not inference** (ADR 20260904-reef-all-the-way-down, D14).
 *
 * The diver-facing half of the evening's "Keep it": one sentence naming the
 * staffer, the piece and roughly when. The reader's refusals matter as much as
 * its answer — a half-present confirmation renders no sentence, which is what
 * stops "somebody kept your BCD" reaching a diver after the staffer who did it
 * was anonymized. What the writer may move is guarded beside `confirmRentalFitSize`
 * below; here the rule is that only the kept piece changed.
 */
describe("fitConfirmationForDiver", () => {
  it("reads back who kept which piece, and when", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Kept Fit");
    const { personId: staffId } = await bookVisitor(db, shopId, tripId, "Keiko Tanaka");
    await saveRentalFit(db, baseFitInput(shopId, personId));

    expect(
      await confirmRentalFitSize(db, {
        shopId,
        personId,
        kind: "bcd",
        size: "L",
        confirmedByPersonId: staffId,
      }),
    ).toBe("saved");

    const fit = await getRentalFit(db, shopId, personId);
    expect(await fitConfirmationForDiver(db, shopId, personId)).toEqual({
      staffFullName: "Keiko Tanaka",
      item: "bcd",
      confirmedAt: fit?.fitConfirmedAt,
    });
    // Only the piece that was kept moved. The rest of the fit is where the
    // diver left it, which is what stops one evening tap rewriting a record.
    expect(fit?.wetsuitSize).toBe("3 mm / M");
    expect(fit?.finSize).toBe("M");
    expect(fit?.weightPreference).toBe("12 lbs");
  });

  it("says nothing at all with no confirmation on file", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nothing To Keep");
    await saveRentalFit(db, baseFitInput(shopId, personId));
    expect(await fitConfirmationForDiver(db, shopId, personId)).toBeNull();
  });

  it("says nothing at all when the staffer who kept it is gone", async () => {
    // The erasure path nulls `fit_confirmed_by`. A line reading "somebody kept
    // your BCD" would be worse than no line, so the whole thing ages out.
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Anonymized Keeper");
    const { personId: staffId } = await bookVisitor(db, shopId, tripId, "Gone Keeper");
    await saveRentalFit(db, baseFitInput(shopId, personId));
    await confirmRentalFitSize(db, {
      shopId,
      personId,
      kind: "bcd",
      size: "L",
      confirmedByPersonId: staffId,
    });
    await db
      .update(rentalFitProfiles)
      .set({ fitConfirmedBy: null })
      .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)));

    expect(await fitConfirmationForDiver(db, shopId, personId)).toBeNull();
  });

  it("says nothing when only the clock was stamped", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Half A Record");
    const { personId: staffId } = await bookVisitor(db, shopId, tripId, "Half Keeper");
    await saveRentalFit(db, baseFitInput(shopId, personId));
    await db
      .update(rentalFitProfiles)
      .set({ fitConfirmedAt: new Date("2026-09-01T12:00:00Z"), fitConfirmedBy: staffId })
      .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)));

    expect(await fitConfirmationForDiver(db, shopId, personId)).toBeNull();
  });
});

describe("listTripPrepDivers", () => {
  it("lists the active roster with fit and live nitrox verification", async () => {
    const { db, shopId, tripId } = await context();
    const { bookingId: fittedBooking, personId: fittedPerson } = await bookVisitor(
      db,
      shopId,
      tripId,
      "Nora Quinn",
    );
    const { bookingId: bareBooking } = await bookVisitor(db, shopId, tripId, "Priya Patel");
    await saveRentalFit(db, baseFitInput(shopId, fittedPerson));

    const cert = await createNitroxCertification(db, {
      shopId,
      personId: fittedPerson,
      agency: "padi",
      identifier: "NX-PREP-1",
    });
    if (!cert) throw new Error("cert insert failed");
    await reviewNitroxCertification(db, { shopId, certificationId: cert.id, status: "verified" });

    const rows = await listTripPrepDivers(db, shopId, tripId);
    const fitted = rows.find((r) => r.bookingId === fittedBooking);
    const bare = rows.find((r) => r.bookingId === bareBooking);
    expect(fitted).toMatchObject({ fullName: "Nora Quinn", hasVerifiedNitroxCard: true });
    expect(fitted?.fit).toMatchObject({ bcdSize: "M" });
    expect(bare).toMatchObject({
      fullName: "Priya Patel",
      fit: null,
      hasVerifiedNitroxCard: false,
    });
  });

  it("excludes a cancelled booking from the active roster", async () => {
    const { db, shopId, tripId } = await context();
    const { bookingId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    await cancelBooking(db, shopId, bookingId);

    const rows = await listTripPrepDivers(db, shopId, tripId);
    expect(rows.some((r) => r.bookingId === bookingId)).toBe(false);
  });
});

describe("rentalFitByBooking", () => {
  it("keys fits by booking id for the trip's active roster", async () => {
    const { db, shopId, tripId } = await context();
    const { bookingId, personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    await saveRentalFit(db, baseFitInput(shopId, personId));

    const map = await rentalFitByBooking(db, shopId, tripId);
    expect(map.get(bookingId)).toMatchObject({ bcdSize: "M" });
  });

  it("maps a booking with no fit on file to null, not a missing entry", async () => {
    const { db, shopId, tripId } = await context();
    const { bookingId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");

    const map = await rentalFitByBooking(db, shopId, tripId);
    expect(map.has(bookingId)).toBe(true);
    expect(map.get(bookingId)).toBeNull();
  });

  it("excludes cancelled bookings from the map", async () => {
    const { db, shopId, tripId } = await context();
    const { bookingId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    await cancelBooking(db, shopId, bookingId);

    const map = await rentalFitByBooking(db, shopId, tripId);
    expect(map.has(bookingId)).toBe(false);
  });
});

/**
 * The stored row and the completeness rule, together — `saveRentalFit` writes
 * a fit, `rentalFitCompleteness` reads it, and the answer has to survive the
 * trip through the database. The reported bug lived exactly here: a row
 * existed, so every surface said "Saved", while the sizes the diver would be
 * handed gear against were blank.
 */
describe("rental fit completeness over a stored profile", () => {
  it("calls a saved fit with a missing size incomplete, and names the piece", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Partial Pat");

    // Rents a BCD, and the only size anybody typed is a fin size.
    await saveRentalFit(db, {
      shopId,
      personId,
      rentsBcd: true,
      rentsRegulator: false,
      rentsWetsuit: false,
      rentsMaskFins: false,
      rentsWeights: false,
      rentsDiveComputer: false,
      rentsGopro: false,
      rentsDrysuit: false,
      rentsHoodGloves: false,
      rentsTorch: false,
      rentsSmb: false,
      finSize: "M",
    });

    const stored = await getRentalFit(db, shopId, personId);
    expect(stored).not.toBeNull();
    expect(rentalFitCompleteness(stored)).toEqual({ state: "incomplete", missing: ["bcd"] });
  });

  it("turns complete once the missing size is filled in", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Filled Fern");

    await saveRentalFit(db, baseFitInput(shopId, personId));
    expect(rentalFitCompleteness(await getRentalFit(db, shopId, personId))).toEqual({
      state: "complete",
    });

    // Staff blank the BCD size — the row is still there, the fit is not done.
    await saveRentalFit(db, { ...baseFitInput(shopId, personId), bcdSize: "" });
    expect(rentalFitCompleteness(await getRentalFit(db, shopId, personId))).toEqual({
      state: "incomplete",
      missing: ["bcd"],
    });
  });

  /**
   * **The evening's "Keep it"** (issue #1174, delight report D14): the size a
   * unit actually went out in, written down because a human at the counter
   * already confirmed the swap.
   */
  describe("confirmRentalFitSize", () => {
    it("writes the one size, stamps who confirmed it, and leaves the staff-fit flag alone", async () => {
      const { db, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Hugo Marsh");
      const [staffPerson] = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.shopId, shopId))
        .limit(1);
      if (!staffPerson) throw new Error("shop has no people");

      await saveRentalFit(db, baseFitInput(shopId, personId));
      await setNeedsStaffFit(db, { shopId, personId, needed: true, note: "no L in stock" });

      expect(
        await confirmRentalFitSize(db, {
          shopId,
          personId,
          kind: "bcd",
          size: "L",
          confirmedByPersonId: staffPerson.id,
        }),
      ).toBe("saved");

      const fit = await getRentalFit(db, shopId, personId);
      expect(fit?.bcdSize).toBe("L");
      // The other sizes are untouched: this answers one question about one
      // piece of gear.
      expect(fit?.wetsuitSize).toBe("3 mm / M");
      expect(fit?.fitStatedAt).toBeInstanceOf(Date);
      expect(fit?.fitConfirmedAt).toBeInstanceOf(Date);
      expect(fit?.fitConfirmedBy).toBe(staffPerson.id);
      // The piece, not just the clock — the diver's thread names it.
      expect(fit?.fitConfirmedItem).toBe("bcd");
      // **Never cleared here.** A stale flag costs one extra look at the
      // counter; a wrongly-cleared one puts a diver in gear nobody checked.
      expect(fit?.needsStaffFitAt).toBeInstanceOf(Date);
    });

    it("claims only the piece it confirmed when the diver had no fit on file", async () => {
      const { db, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Fresh Fiona");
      const [staffPerson] = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.shopId, shopId))
        .limit(1);
      if (!staffPerson) throw new Error("shop has no people");

      // No `saveRentalFit` first: the evening's tap is a door onto this table
      // of its own, and it stamps `fit_stated_at`. Without the all-false
      // baseline the row it creates claimed the five `default(true)` pieces
      // beside the one size a human actually confirmed (issue #1755).
      expect(
        await confirmRentalFitSize(db, {
          shopId,
          personId,
          kind: "bcd",
          size: "L",
          confirmedByPersonId: staffPerson.id,
        }),
      ).toBe("saved");

      const fit = await getRentalFit(db, shopId, personId);
      expect(fit?.bcdSize).toBe("L");
      expect(fit?.fitStatedAt).toBeInstanceOf(Date);
      expect(fit).toMatchObject(NOTHING_RENTED);
    });

    it("refuses a person from another shop, and an empty size", async () => {
      const { db, shopId, tripId } = await context();
      const { personId } = await bookVisitor(db, shopId, tripId, "Elsewhere Elsa");
      const [staffPerson] = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.shopId, shopId))
        .limit(1);
      if (!staffPerson) throw new Error("shop has no people");

      expect(
        await confirmRentalFitSize(db, {
          shopId: "00000000-0000-4000-8000-000000000000",
          personId,
          kind: "bcd",
          size: "L",
          confirmedByPersonId: staffPerson.id,
        }),
      ).toBe("unknown_person");
      expect(
        await confirmRentalFitSize(db, {
          shopId,
          personId,
          kind: "bcd",
          size: "  ",
          confirmedByPersonId: staffPerson.id,
        }),
      ).toBe("invalid");
      expect(await getRentalFit(db, shopId, personId)).toBeNull();
    });
  });

  it("keeps 'nobody asked' distinct from 'asked and half blank'", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Unasked Uma");
    expect(rentalFitCompleteness(await getRentalFit(db, shopId, personId))).toEqual({
      state: "not_recorded",
    });
  });
});
