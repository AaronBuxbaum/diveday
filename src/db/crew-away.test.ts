import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { crewAwayByTrip } from "./crew-away";
import { acknowledgeCrewAway } from "./crew-away-acknowledgements";
import { saveCrewAvailabilityBlock } from "./crew-requests";
import { crewAvailabilityBlocks, crewAwayAcknowledgements } from "./schema";
import { changeTripCrew, createTrip, listStaff, setTripCrew } from "./trips";

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

  /**
   * **"Working it anyway"** (issue #2678): a staffer's acknowledgement on one
   * crew assignment. It is read beside the days away, refused for anybody not
   * on the crew or in another shop, and taken off with the person.
   */
  describe("working it anyway", () => {
    it("marks the acknowledged person on that departure only, and leaves their block alone", async () => {
      const { db, shop } = ctx;
      const sunday = await rostered("Ack Sunday", "2027-06-13T15:00:00Z");
      const saturday = await rostered("Ack Saturday", "2027-06-12T15:00:00Z");
      await away(sunday.instructor.id, "2027-06-12", "2027-06-13");
      expect(
        await acknowledgeCrewAway(db, {
          shopId: shop.id,
          tripId: sunday.trip.id,
          personId: sunday.instructor.id,
          actorPersonId: sunday.captain.id,
        }),
      ).toBe("saved");
      // Twice is one row, and still saved.
      expect(
        await acknowledgeCrewAway(db, {
          shopId: shop.id,
          tripId: sunday.trip.id,
          personId: sunday.instructor.id,
          actorPersonId: sunday.captain.id,
        }),
      ).toBe("saved");
      const result = await crewAwayByTrip(
        db,
        shop.id,
        [sunday.trip.id, saturday.trip.id],
        shop.timezone,
      );
      expect(result.get(sunday.trip.id)?.[0]).toMatchObject({
        personId: sunday.instructor.id,
        acknowledged: true,
      });
      expect(result.get(saturday.trip.id)?.[0]).toMatchObject({
        personId: sunday.instructor.id,
        acknowledged: false,
      });
      // The block, and its note, are the person's own and untouched.
      const [block] = await db
        .select()
        .from(crewAvailabilityBlocks)
        .where(
          and(
            eq(crewAvailabilityBlocks.personId, sunday.instructor.id),
            eq(crewAvailabilityBlocks.startsOn, "2027-06-12"),
          ),
        );
      expect(block).toMatchObject({ note: "Family trip", deletedAt: null });
    });

    it("refuses a person who is not on the crew, and another shop", async () => {
      const { db, shop } = ctx;
      const { trip, captain } = await rostered("Ack refusals", "2027-06-20T15:00:00Z");
      const staff = await listStaff(db, shop.id);
      const offCrew = staff.find(
        (entry) => !entry.roles.includes("instructor") && !entry.roles.includes("captain"),
      )?.person;
      if (!offCrew) throw new Error("seeded staff missing an off-crew member");
      expect(
        await acknowledgeCrewAway(db, {
          shopId: shop.id,
          tripId: trip.id,
          personId: offCrew.id,
          actorPersonId: captain.id,
        }),
      ).toBe("not_on_crew");
      expect(
        await acknowledgeCrewAway(db, {
          shopId: "00000000-0000-4000-8000-000000000000",
          tripId: trip.id,
          personId: captain.id,
          actorPersonId: captain.id,
        }),
      ).toBe("not_on_crew");
      expect(await db.select().from(crewAwayAcknowledgements)).toEqual([]);
    });

    it("goes with the person when they come off the crew, either way they are taken off", async () => {
      const { db, shop } = ctx;
      const { trip, instructor, captain } = await rostered("Ack cleared", "2027-06-27T15:00:00Z");
      await away(instructor.id, "2027-06-27", "2027-06-27");
      await away(captain.id, "2027-06-27", "2027-06-27");
      for (const person of [instructor, captain]) {
        await acknowledgeCrewAway(db, {
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
          actorPersonId: captain.id,
        });
      }
      // One taken off by a single change, then the whole crew rewritten.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          operation: "unassign",
          personId: captain.id,
        }),
      ).toBe(true);
      expect(
        await setTripCrew(db, shop.id, trip.id, [{ personId: captain.id, tripRole: "captain" }]),
      ).toBe(true);
      const live = await db
        .select()
        .from(crewAwayAcknowledgements)
        .where(
          and(
            eq(crewAwayAcknowledgements.tripId, trip.id),
            isNull(crewAwayAcknowledgements.deletedAt),
          ),
        );
      expect(live).toEqual([]);
      // Back on the crew, the captain starts unconfirmed.
      expect((await crewAwayByTrip(db, shop.id, [trip.id], shop.timezone)).get(trip.id)).toEqual([
        expect.objectContaining({ personId: captain.id, acknowledged: false }),
      ]);
    });
  });
});
