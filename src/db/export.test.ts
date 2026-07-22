// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildExportFiles } from "@/lib/export";
import { seededShopContext } from "@/test/db";
import { loadShopExport } from "./export";
import { bookings, certifications, people, personRoles, shops, trips } from "./schema";

/**
 * A second tenant whose every string is a canary: if any of it appears in the
 * first shop's export, the export leaked across shops.
 */
async function seedCanaryShop(db: Awaited<ReturnType<typeof seededShopContext>>["db"]) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "CANARY Dive Co", slug: "canary-dive-co", timezone: "Pacific/Palau" })
    .returning();
  const [rivalDiver] = await db
    .insert(people)
    .values({ shopId: rival.id, fullName: "LEAK-CANARY Diver", email: "leak@canary.example" })
    .returning();
  await db.insert(personRoles).values({ personId: rivalDiver.id, role: "diver" });
  await db.insert(certifications).values({
    shopId: rival.id,
    personId: rivalDiver.id,
    agency: "padi",
    level: "open_water",
    identifier: "CANARY-CERT-0001",
  });
  const [rivalTrip] = await db
    .insert(trips)
    .values({
      shopId: rival.id,
      title: "CANARY Wreck Special",
      startsAt: new Date("2026-08-01T08:00:00.000Z"),
      endsAt: new Date("2026-08-01T12:00:00.000Z"),
      capacity: 8,
    })
    .returning();
  await db
    .insert(bookings)
    .values({ shopId: rival.id, tripId: rivalTrip.id, personId: rivalDiver.id });
  return rival;
}

describe("loadShopExport (in-memory PGlite)", () => {
  it("loads the seeded shop's data across every dataset", async () => {
    const { db, shop } = await seededShopContext();
    const data = await loadShopExport(db, shop.id);
    expect(data).not.toBeNull();
    if (!data) return;

    expect(data.shop.slug).toBe("blue-mantis");
    expect(data.people.length).toBeGreaterThan(0);
    expect(data.trips.length).toBeGreaterThan(0);
    expect(data.bookings.length).toBeGreaterThan(0);
    expect(data.waiverTemplates.length).toBeGreaterThan(0);
    // Roles are aggregated onto people, sorted for stable CSVs.
    const someStaff = data.people.find((person) => person.roles.includes("owner"));
    expect(someStaff).toBeDefined();
    // Trip-scoped tables with no shop_id of their own still arrive.
    expect(data.tripRequirements.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown shop rather than an empty export", async () => {
    const { db } = await seededShopContext();
    await expect(loadShopExport(db, "00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("never leaks another shop's rows into the bundle", async () => {
    const { db, shop } = await seededShopContext();
    const rival = await seedCanaryShop(db);

    const data = await loadShopExport(db, shop.id);
    if (!data) throw new Error("expected export data");
    const bundle = Object.values(buildExportFiles(data, new Date())).join("\n");
    expect(bundle).not.toContain("CANARY");
    expect(bundle).not.toContain("leak@canary.example");

    // And the canary shop's own export sees exactly its rows — scoping, not luck.
    const rivalData = await loadShopExport(db, rival.id);
    if (!rivalData) throw new Error("expected rival export data");
    expect(rivalData.people.map((person) => person.fullName)).toEqual(["LEAK-CANARY Diver"]);
    expect(rivalData.trips.map((trip) => trip.title)).toEqual(["CANARY Wreck Special"]);
    expect(rivalData.bookings).toHaveLength(1);
  });
});
