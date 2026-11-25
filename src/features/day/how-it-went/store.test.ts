import { describe, expect, it } from "vitest";
import { recordRollCall } from "@/db/manifests";
import { getTripRoster, listStaff } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { fileScopedShopContext } from "@/test/db";
import { getHowItWentPage } from "./store";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

async function context() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  const staffRows = await listStaff(db, shop.id);
  const owner = staffRows.find((row) => row.roles.includes("owner"))?.person;
  const crew = staffRows.find((row) => !row.roles.includes("owner"))?.person;
  if (!reef || !owner || !crew) throw new Error("demo shop needs a reef trip, an owner and crew");
  return { db, shop, reef, owner, crew };
}

describe("getHowItWentPage (in-memory PGlite)", () => {
  it("refuses a staffer the departure log's gate refuses", async () => {
    const { db, shop, reef, crew } = await context();
    expect(await getHowItWentPage(db, shop.id, reef.id, crew.id)).toEqual({ allowed: false });
  });

  it("finds nothing for a trip id that is not this shop's", async () => {
    const { db, shop, owner } = await context();
    const page = await getHowItWentPage(
      db,
      shop.id,
      "00000000-0000-4000-8000-000000000000",
      owner.id,
    );
    expect(page).toEqual({ allowed: true, page: null });
  });

  it("says a count nobody took was not taken, and counts only who was recorded", async () => {
    const { db, shop, reef, owner } = await context();
    const before = await getHowItWentPage(db, shop.id, reef.id, owner.id);
    if (!before.allowed || !before.page) throw new Error("expected the owner's page");
    for (const count of before.page.recap.counts) {
      expect(count).toMatchObject({ taken: false, divers: 0, crew: 0, notRecorded: [], at: null });
    }

    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    const marked = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: first.booking.id,
      recordedByPersonId: owner.id,
      // Left ashore at the dock: recorded, but nobody aboard.
      status: "not_boarded",
    });
    expect(marked).toMatchObject({ ok: true });

    const after = await getHowItWentPage(db, shop.id, reef.id, owner.id);
    if (!after.allowed || !after.page) throw new Error("expected the owner's page");
    const dock = after.page.recap.counts[0];
    expect(dock).toMatchObject({ dive: 0, taken: true, divers: 0, by: owner.fullName });
    expect(dock?.ashore).toEqual([first.person.fullName]);
    // Everyone else at the dock count is named as not recorded, never as aboard or ashore.
    expect(dock?.notRecorded).not.toContain(first.person.fullName);
    expect(dock?.notRecorded.length).toBeGreaterThan(0);
    // The dives after it were not counted.
    expect(after.page.recap.counts.slice(1).every((count) => !count.taken)).toBe(true);
  });
});
