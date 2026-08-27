import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rentalFitLine } from "@/lib/dive-prep";
import { rentalFitCompleteness } from "@/lib/rentals";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createNitroxCertification, reviewNitroxCertification } from "./nitrox";
import {
  getRentalFit,
  listTripPrepDivers,
  rentalFitByBooking,
  saveRentalFit,
  saveRentalFitNote,
  setNeedsStaffFit,
} from "./rental-fit";
import { people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("open trip missing");
  return { db, shopId: shop.id, tripId: open.id };
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

  it("returns null for a person with no fit on file", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Nora Quinn");
    expect(await getRentalFit(db, shopId, personId)).toBeNull();
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

  it("keeps 'nobody asked' distinct from 'asked and half blank'", async () => {
    const { db, shopId, tripId } = await context();
    const { personId } = await bookVisitor(db, shopId, tripId, "Unasked Uma");
    expect(rentalFitCompleteness(await getRentalFit(db, shopId, personId))).toEqual({
      state: "not_recorded",
    });
  });
});
