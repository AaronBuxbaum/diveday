import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { crewAwayByTrip } from "./crew-away";
import { saveCrewAvailabilityBlock } from "./crew-requests";
import { createTrip, listStaff, setTripCrew } from "./trips";

const ctx = fileScopedShopContext();

/**
 * **Away and rostered, joined once** (fourth review, item 12). The staffing
 * week said Marcus was away the weekend he taught both Sunday sessions; the
 * board, Today and his own session card read from this instead of saying
 * nothing.
 */
describe("crewAwayByTrip", () => {
  async function rostered(title: string, startsAt: string) {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"))?.person;
    const captain = staff.find((entry) => entry.roles.includes("captain"))?.person;
    if (!instructor || !captain) throw new Error("seeded staff missing");
    const starts = new Date(startsAt);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 1,
    });
    if (!trip) throw new Error(`failed to create ${title}`);
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        { personId: instructor.id, tripRole: "instructor" },
        { personId: captain.id, tripRole: "captain" },
      ]),
    ).toBe(true);
    return { trip, instructor, captain };
  }

  async function away(personId: string, startsOn: string, endsOn: string) {
    const { db, shop } = ctx;
    const outcome = await saveCrewAvailabilityBlock(db, {
      shopId: shop.id,
      personId,
      actorPersonId: personId,
      canManageRoster: false,
      startsOn,
      endsOn,
      note: "Family trip",
    });
    expect(outcome.ok).toBe(true);
  }

  it("names the rostered person away on the day the departure meets, with those days", async () => {
    const { db, shop } = ctx;
    // Mid-morning on Sun Mar 14 2027 in any US zone.
    const { trip, instructor, captain } = await rostered(
      "Sunday refresher",
      "2027-03-14T15:00:00Z",
    );
    await away(instructor.id, "2027-03-13", "2027-03-14");
    // The captain is away later that week: no overlap, no mark.
    await away(captain.id, "2027-03-17", "2027-03-18");

    const result = await crewAwayByTrip(db, shop.id, [trip.id], shop.timezone);
    expect(result.get(trip.id)).toEqual([
      expect.objectContaining({
        personId: instructor.id,
        fullName: instructor.fullName,
        blocks: [expect.objectContaining({ startsOn: "2027-03-13", endsOn: "2027-03-14" })],
      }),
    ]);
  });

  it("leaves out a departure nobody away is rostered on", async () => {
    const { db, shop } = ctx;
    const { trip } = await rostered("Tuesday wreck", "2027-04-06T15:00:00Z");
    expect((await crewAwayByTrip(db, shop.id, [trip.id], shop.timezone)).has(trip.id)).toBe(false);
  });

  it("answers nothing about another shop's departure", async () => {
    const { db, shop } = ctx;
    const { trip, instructor } = await rostered("Other-shop probe", "2027-05-09T15:00:00Z");
    await away(instructor.id, "2027-05-09", "2027-05-09");
    expect(
      (await crewAwayByTrip(db, "00000000-0000-4000-8000-000000000000", [trip.id], shop.timezone))
        .size,
    ).toBe(0);
    expect((await crewAwayByTrip(db, shop.id, [], shop.timezone)).size).toBe(0);
  });
});
