// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  createDiver,
  deleteDiver,
  getDiverProfile,
  listBookableDivers,
  listDiverSummaries,
  restoreDiver,
  updateDiver,
} from "./divers";
import { saveRentalFit } from "./rental-fit";
import { upcomingTripsWithCounts } from "./trips";

describe("person-first diver records", () => {
  it("composes cards, fit, and history from one diver record", async () => {
    const { db, shop } = await seededShopContext();

    const { divers: summaries } = await listDiverSummaries(db, shop.id);
    const priya = summaries.find((row) => row.person.fullName === "Priya Sharma");
    expect(priya).toMatchObject({ certificationCount: 1, pendingCertificationCount: 0 });
    if (!priya) throw new Error("seed diver missing");

    const profile = await saveRentalFit(db, {
      shopId: shop.id,
      personId: priya.person.id,
      rentsBcd: true,
      rentsRegulator: false,
      rentsWetsuit: true,
      rentsMaskFins: true,
      rentsWeights: true,
      rentsDiveComputer: false,
      rentsGopro: false,
      bcdSize: "M",
      wetsuitSize: "3 mm / M",
      finSize: "L",
      weightPreference: "12 lb",
    });
    expect(profile).toMatchObject({ bcdSize: "M", wetsuitSize: "3 mm / M" });

    const detail = await getDiverProfile(db, shop.id, priya.person.id);
    expect(detail?.rentalFit).toMatchObject({ bcdSize: "M", finSize: "L", rentsRegulator: false });
    expect(detail?.certifications).toHaveLength(1);
  });

  it("can add a returning diver before a booking and rejects staff-only records", async () => {
    const { db, shop } = await seededShopContext();

    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Returning Riley",
      email: "riley@example.com",
      phone: "+1 305 555 0199",
    });
    expect(diver).toMatchObject({ fullName: "Returning Riley", email: "riley@example.com" });
    if (!diver) throw new Error("diver insert failed");
    expect(
      await createDiver(db, {
        shopId: shop.id,
        fullName: "Duplicate Riley",
        email: "RILEY@example.com",
      }),
    ).toBeNull();

    const updated = await updateDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Returning Riley Updated",
      email: "riley@example.com",
      phone: "555",
    });
    expect(updated?.fullName).toBe("Returning Riley Updated");

    const staff = (await listDiverSummaries(db, shop.id)).divers.find(
      (row) => row.person.fullName === "Dana Reyes",
    );
    expect(staff).toBeUndefined();
  });

  it("soft-deletes a diver without erasing their record", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Archived Alex",
      email: "alex@example.com",
    });
    if (!diver) throw new Error("diver insert failed");

    expect(await deleteDiver(db, shop.id, diver.id)).toBe(true);
    expect(
      (await listDiverSummaries(db, shop.id)).divers.some((row) => row.person.id === diver.id),
    ).toBe(false);
    expect(await getDiverProfile(db, shop.id, diver.id)).toBeNull();
    expect(await restoreDiver(db, shop.id, diver.id)).toBe(true);
    expect(
      (await listDiverSummaries(db, shop.id)).divers.some((row) => row.person.id === diver.id),
    ).toBe(true);
  });
});

describe("roster search and pagination", () => {
  it("searches server-side by name, email, or phone", async () => {
    const { db, shop } = await seededShopContext();

    const byName = await listDiverSummaries(db, shop.id, { query: "priya" });
    expect(byName.divers.map((row) => row.person.fullName)).toEqual(["Priya Sharma"]);
    expect(byName.total).toBe(1);

    const byEmail = await listDiverSummaries(db, shop.id, { query: "priya.sharma@example" });
    expect(byEmail.divers).toHaveLength(1);

    const nobody = await listDiverSummaries(db, shop.id, { query: "zzz-no-such-diver" });
    expect(nobody.divers).toHaveLength(0);
    expect(nobody.total).toBe(0);
    expect(nobody.nextCursor).toBeNull();
  });

  it("pages with a keyset cursor and never repeats or skips a diver", async () => {
    const { db, shop } = await seededShopContext();

    const all = await listDiverSummaries(db, shop.id);
    expect(all.nextCursor).toBeNull(); // seed fits one default page
    expect(all.total).toBe(all.divers.length);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let hops = 0; hops < 20; hops++) {
      const page = await listDiverSummaries(db, shop.id, { cursor, limit: 3 });
      expect(page.divers.length).toBeLessThanOrEqual(3);
      seen.push(...page.divers.map((row) => row.person.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.divers.map((row) => row.person.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("treats a mangled cursor as the first page", async () => {
    const { db, shop } = await seededShopContext();
    const all = await listDiverSummaries(db, shop.id);
    const mangled = await listDiverSummaries(db, shop.id, { cursor: "not-a-real-cursor" });
    expect(mangled.divers.map((row) => row.person.id)).toEqual(
      all.divers.map((row) => row.person.id),
    );
  });
});

describe("listBookableDivers (returning-diver picker)", () => {
  async function openTrip(db: AppDb, shopId: string) {
    const trips = await upcomingTripsWithCounts(db, shopId);
    const trip = trips.find((t) => t.booked < t.capacity);
    if (!trip) throw new Error("no open seeded trip");
    return trip;
  }

  it("returns nothing for an empty query", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    expect(await listBookableDivers(db, shop.id, trip.id, { query: "  " })).toEqual([]);
  });

  it("finds a returning diver and carries their rental fit", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Marina Vega",
      email: "marina@example.com",
    });
    if (!diver) throw new Error("diver setup failed");
    await saveRentalFit(db, {
      shopId: shop.id,
      personId: diver.id,
      rentsBcd: true,
      rentsRegulator: true,
      rentsWetsuit: true,
      rentsMaskFins: true,
      rentsWeights: true,
      rentsDiveComputer: false,
      rentsGopro: false,
      wetsuitSize: "5 mm / M",
    });

    const matches = await listBookableDivers(db, shop.id, trip.id, { query: "marina" });
    expect(matches.map((m) => m.person.fullName)).toEqual(["Marina Vega"]);
    expect(matches[0]?.rentalFit).toMatchObject({ wetsuitSize: "5 mm / M" });
  });

  it("excludes a diver already holding an active seat on the trip", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Booked Bianca",
      email: "bianca@example.com",
    });
    if (!diver) throw new Error("diver setup failed");

    expect(
      (await listBookableDivers(db, shop.id, trip.id, { query: "bianca" })).map(
        (m) => m.person.fullName,
      ),
    ).toEqual(["Booked Bianca"]);

    const booked = await createBooking(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
    });
    expect(booked.ok).toBe(true);

    expect(await listBookableDivers(db, shop.id, trip.id, { query: "bianca" })).toEqual([]);
  });

  it("omits soft-deleted divers", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Gone Gary",
      email: "gary@example.com",
    });
    if (!diver) throw new Error("diver setup failed");
    await deleteDiver(db, shop.id, diver.id);
    expect(await listBookableDivers(db, shop.id, trip.id, { query: "gary" })).toEqual([]);
  });
});
