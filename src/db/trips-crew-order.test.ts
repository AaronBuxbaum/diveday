import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getTripCrewAssignments, listStaff, setTripCrew } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

const ctx = fileScopedShopContext();

describe("trip crew order", () => {
  async function context() {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id))[0];
    if (!trip) throw new Error("expected a seeded trip");
    return { db, shop, trip };
  }

  it("lists a crew captain first, then by name, whatever order it was written in", async () => {
    const { db, shop, trip } = await context();
    const staff = await listStaff(db, shop.id);
    const named = (name: string) => {
      const found = staff.find((entry) => entry.person.fullName === name);
      if (!found) throw new Error(`seeded ${name} missing`);
      return found.person;
    };
    const [keiko, sal, yusra] = [
      named("Keiko Tanaka"),
      named("Sal Moretti"),
      named("Yusra Idrissi"),
    ];
    // Written last-name-first, so insertion order is the opposite of the answer.
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        { personId: yusra.id, tripRole: null },
        { personId: sal.id, tripRole: null },
        { personId: keiko.id, tripRole: null },
      ]),
    ).toBe(true);
    const ids = async () =>
      (await getTripCrewAssignments(db, shop.id, trip.id)).map((row) => row.personId);
    expect(await ids()).toEqual([keiko.id, sal.id, yusra.id]);
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        { personId: keiko.id, tripRole: "divemaster" },
        { personId: yusra.id, tripRole: null },
        { personId: sal.id, tripRole: "captain" },
      ]),
    ).toBe(true);
    expect(await ids()).toEqual([sal.id, keiko.id, yusra.id]);
  });
});
