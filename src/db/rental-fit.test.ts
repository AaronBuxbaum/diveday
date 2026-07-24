// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createNitroxCertification, reviewNitroxCertification } from "./nitrox";
import { getRentalFit, listTripPrepDivers, rentalFitByBooking, saveRentalFit } from "./rental-fit";
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
  const outcome = await createBooking(db, { shopId, tripId, fullName, email });
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
