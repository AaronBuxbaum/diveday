import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import { createDiver, listDiverSummaries } from "../features/people/divers/store";
import type { AppDb } from "./client";
import { bookings, priorVisits, shops, trips } from "./schema";

/**
 * The roster's "Lapsed regulars" view (issue #4246): three or more dive days
 * with the shop, merged with imported visits, and none in twelve months.
 */

const NOW = new Date("2031-10-14T12:00:00Z");
let seq = 0;

async function freshShop(db: AppDb) {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Lapsed Shop", slug: `lapsed-shop-${seq}`, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop.id;
}

async function diver(db: AppDb, shopId: string, fullName: string) {
  const person = await createDiver(db, { shopId, fullName });
  if (!person) throw new Error("diver insert failed");
  return person.id;
}

async function dived(
  db: AppDb,
  shopId: string,
  personId: string,
  startsAt: Date,
  status: "booked" | "cancelled" | "no_show" = "booked",
) {
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity: 10,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId: trip.id, personId, status });
}

async function visited(
  db: AppDb,
  shopId: string,
  personId: string,
  visitedOn: string,
  statusLabel: string | null = null,
) {
  await db.insert(priorVisits).values({
    shopId,
    personId,
    visitedOn,
    statusLabel,
    dedupeKey: `${personId}-${visitedOn}-${statusLabel ?? ""}`,
    importedAt: NOW,
  });
}

describe("the lapsed regulars view", () => {
  it("lists three dive days and none in a year, imported visits merged, and counts them alike", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    // Two boats here and one imported visit: three days.
    const mixed = await diver(db, shopId, "Mia Mixed");
    await dived(db, shopId, mixed, new Date("2029-05-01T13:00:00Z"));
    await dived(db, shopId, mixed, new Date("2029-06-01T13:00:00Z"));
    await visited(db, shopId, mixed, "2028-03-10");
    // Three imported visits only.
    const imported = await diver(db, shopId, "Ira Imported");
    for (const day of ["2027-01-02", "2027-02-02", "2028-02-02"]) {
      await visited(db, shopId, imported, day);
    }
    const page = await listDiverSummaries(db, shopId, { filter: "lapsed_regulars", now: NOW });
    expect(page.divers.map((row) => row.fullName)).toEqual(["Ira Imported", "Mia Mixed"]);
    expect(page.total).toBe(2);
  });

  it("leaves out a regular who came back inside the year", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const back = await diver(db, shopId, "Ben Back");
    await dived(db, shopId, back, new Date("2028-05-01T13:00:00Z"));
    await dived(db, shopId, back, new Date("2028-06-01T13:00:00Z"));
    await dived(db, shopId, back, new Date("2031-09-01T13:00:00Z"));
    const page = await listDiverSummaries(db, shopId, { filter: "lapsed_regulars", now: NOW });
    expect(page.total).toBe(0);
  });

  it("counts a day once, and never counts a cancelled seat, a no-show or a failed visit", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const short = await diver(db, shopId, "Sam Short");
    // A morning and an afternoon boat are one day; the imported visit that
    // day is that same day.
    await dived(db, shopId, short, new Date("2029-05-01T13:00:00Z"));
    await dived(db, shopId, short, new Date("2029-05-01T18:00:00Z"));
    await visited(db, shopId, short, "2029-05-01");
    await dived(db, shopId, short, new Date("2029-07-01T13:00:00Z"), "cancelled");
    await dived(db, shopId, short, new Date("2029-08-01T13:00:00Z"), "no_show");
    await visited(db, shopId, short, "2029-09-01", "Cancelled");
    // One real day more makes two, still short of three.
    await dived(db, shopId, short, new Date("2029-10-01T13:00:00Z"));
    const page = await listDiverSummaries(db, shopId, { filter: "lapsed_regulars", now: NOW });
    expect(page.total).toBe(0);
  });

  it("reads the day in the shop's zone, not UTC", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const late = await diver(db, shopId, "Lu Late");
    // 01:00 UTC on the 2nd is the evening of the 1st in New York: one day.
    await dived(db, shopId, late, new Date("2029-05-01T13:00:00Z"));
    await dived(db, shopId, late, new Date("2029-05-02T01:00:00Z"));
    await dived(db, shopId, late, new Date("2029-06-01T13:00:00Z"));
    const page = await listDiverSummaries(db, shopId, {
      filter: "lapsed_regulars",
      now: NOW,
      timeZone: "America/New_York",
    });
    expect(page.total).toBe(0);
    const utc = await listDiverSummaries(db, shopId, { filter: "lapsed_regulars", now: NOW });
    expect(utc.total).toBe(1);
  });
});
