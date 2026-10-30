import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { createDiver, listDiverSummaries, listDiversForExport, notBackCutoff } from "./divers";
import { bookings, people, personRoles, priorVisits, shops, trips } from "./schema";

/**
 * The roster's "Last dived" sort, its "Not back in 12 months" view, and the
 * list's own CSV (fourth UX review, item 27).
 */

const NOW = new Date("2031-10-14T12:00:00Z");
let seq = 0;

async function freshShop(db: AppDb) {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Roster Shop", slug: `roster-shop-${seq}`, timezone: "UTC" })
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
  status: "booked" | "checked_in" | "cancelled" | "no_show" = "booked",
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

async function roster(db: AppDb, shopId: string) {
  const recent = await diver(db, shopId, "Ana Recent");
  const lapsed = await diver(db, shopId, "Bo Lapsed");
  const imported = await diver(db, shopId, "Cy Imported");
  const never = await diver(db, shopId, "Al Never");
  await dived(db, shopId, recent, new Date("2031-09-01T13:00:00Z"));
  await dived(db, shopId, lapsed, new Date("2029-05-01T13:00:00Z"));
  // A cancelled seat and a no-show are no dive day (`diveDay`, the one rule),
  // and a boat that has not left is not a dive.
  await dived(db, shopId, lapsed, new Date("2031-08-01T13:00:00Z"), "cancelled");
  await dived(db, shopId, lapsed, new Date("2031-07-01T13:00:00Z"), "no_show");
  await dived(db, shopId, never, new Date("2031-11-01T13:00:00Z"));
  await db.insert(priorVisits).values({
    shopId,
    personId: imported,
    visitedOn: "2030-03-10",
    dedupeKey: "visit-1",
    importedAt: NOW,
  });
  return { recent, lapsed, imported, never };
}

describe("the roster by last dive", () => {
  it("sorts most recent dive first, imported visits counted, never-dived last", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    await roster(db, shopId);
    const page = await listDiverSummaries(db, shopId, { sort: "last_dived", now: NOW });
    expect(
      page.divers.map((row) => [row.fullName, row.lastDivedAt?.toISOString() ?? null]),
    ).toEqual([
      ["Ana Recent", "2031-09-01T13:00:00.000Z"],
      ["Cy Imported", "2030-03-10T12:00:00.000Z"],
      ["Bo Lapsed", "2029-05-01T13:00:00.000Z"],
      ["Al Never", null],
    ]);
    const byName = await listDiverSummaries(db, shopId, { now: NOW });
    expect(byName.divers.map((row) => row.fullName)).toEqual([
      "Al Never",
      "Ana Recent",
      "Bo Lapsed",
      "Cy Imported",
    ]);
  });

  it("lists who has dived and not been back in twelve months, and counts them alike", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    await roster(db, shopId);
    const page = await listDiverSummaries(db, shopId, { filter: "not_back", now: NOW });
    expect(page.divers.map((row) => row.fullName)).toEqual(["Bo Lapsed", "Cy Imported"]);
    expect(page.total).toBe(2);
    expect(notBackCutoff(NOW).toISOString()).toBe("2030-10-14T12:00:00.000Z");
  });

  it("writes the list as shown, and never another shop's divers", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const other = await freshShop(db);
    await roster(db, shopId);
    await diver(db, other, "Zed Elsewhere");
    const result = await listDiversForExport(db, shopId, {
      filter: "not_back",
      sort: "last_dived",
      now: NOW,
    });
    expect(result.exceededLimit).toBe(false);
    expect(result.rows.map((row) => row.fullName)).toEqual(["Cy Imported", "Bo Lapsed"]);
    expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual([
      "email",
      "fullName",
      "lastDivedAt",
      "phone",
    ]);
    expect(
      (await listDiversForExport(db, other, { now: NOW })).rows.map((row) => row.fullName),
    ).toEqual(["Zed Elsewhere"]);
  });

  it("fetches one row past the limit and returns no partial export", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const peopleRows = Array.from({ length: 5_001 }, (_, index) => ({
      shopId,
      fullName: `Diver ${String(index).padStart(4, "0")}`,
    }));
    const inserted = await db.insert(people).values(peopleRows).returning({ id: people.id });
    await db
      .insert(personRoles)
      .values(inserted.map(({ id }) => ({ personId: id, role: "diver" as const })));

    const result = await listDiversForExport(db, shopId, { now: NOW });

    expect(result.exceededLimit).toBe(true);
    expect(result.rows).toEqual([]);
  });
});
