import { describe, expect, it } from "vitest";
import { listStaff, listTripDives } from "@/db/trips";
import { recordDiveParticipation } from "@/features/dive-participation";
import { fileScopedShopContext } from "@/test/db";
import { getRecapPageData } from "./store";
import { recapFixtureContext } from "./store.test-support";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();
const recapContext = () => recapFixtureContext(ctx);

describe("a dive the crew said this diver sat out (issue #4307)", () => {
  it("names no site from it, and changes nothing else", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("no staff");
    const dives = await listTripDives(db, shop.id, reef.id);
    const siteOf = (n: number) => dives.find(({ dive }) => dive.diveNumber === n)?.diveSite?.name;
    const first = siteOf(1);
    const second = siteOf(2);
    if (!first || !second || first === second) throw new Error("the reef needs two named sites");
    const before = await getRecapPageData(db, bookingId);
    expect(before?.sites.map((site) => site.name)).toEqual([first, second]);

    // Unknown and dived both keep the dive: only "sat out" takes it off.
    const note = { shopId: shop.id, tripId: reef.id, bookingId, diveNumber: 2 };
    await recordDiveParticipation(db, {
      ...note,
      participation: "dived",
      recordedByPersonId: staff.person.id,
    });
    expect((await getRecapPageData(db, bookingId))?.sites.map((s) => s.name)).toEqual([
      first,
      second,
    ]);
    await recordDiveParticipation(db, {
      ...note,
      participation: "sat_out",
      recordedByPersonId: staff.person.id,
    });
    const after = await getRecapPageData(db, bookingId);
    expect(after?.sites.map((site) => site.name)).toEqual([first]);
    expect(after?.fieldGuide.map((guide) => guide.siteName)).not.toContain(second);
    // The day, the count and when they may fly are not this note's to move.
    expect(after?.flySafe).toEqual(before?.flySafe);
    expect(after?.visitCount).toBe(before?.visitCount);
    expect(after?.trip.plannedDives).toBe(before?.trip.plannedDives);

    // Corrected back to unknown, the record names the whole day again.
    await recordDiveParticipation(db, {
      ...note,
      participation: "unknown",
      recordedByPersonId: staff.person.id,
    });
    expect((await getRecapPageData(db, bookingId))?.sites.map((s) => s.name)).toEqual([
      first,
      second,
    ]);
  });
});
