import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { fileScopedShopContext } from "@/test/db";
import { diverCrewWithAway } from "./crew-away-diver";
import { crewAvailabilityBlocks } from "./schema";
import { tripPublicCrew, upcomingTripsWithCounts } from "./trips";

/**
 * **A diver is not promised an instructor who is away** (fourth UX review,
 * item 12, the diver's half). Marcus marked himself away for the weekend while
 * rostered to teach Sunday, and the student's `/ready` read "Marcus ·
 * Instructor". The thread keeps his role and drops his name for a departure
 * he is away on; the staff surfaces say the rest.
 */

const ctx = fileScopedShopContext();

async function aCrewedDeparture() {
  const { db, shop } = ctx;
  for (const trip of await upcomingTripsWithCounts(db, shop.id)) {
    const crew = await tripPublicCrew(db, shop.id, trip.id);
    if (crew.length > 0) return { db, shop, trip, crew };
  }
  throw new Error("seed has no publicly crewed departure");
}

async function away(personId: string, startsOn: string, endsOn: string) {
  await ctx.db.insert(crewAvailabilityBlocks).values({
    shopId: ctx.shop.id,
    personId,
    createdByPersonId: personId,
    startsOn,
    endsOn,
    note: "Family trip",
  });
}

describe("diverCrewWithAway", () => {
  it("marks a named crew member away on a day the departure meets", async () => {
    const { db, shop, trip, crew } = await aCrewedDeparture();
    const [first] = crew;
    if (!first) throw new Error("expected a named crew member");
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    await away(first.personId, day, day);

    const marked = await diverCrewWithAway(db, shop.id, trip, shop.timezone);
    expect(marked.find((member) => member.personId === first.personId)?.away).toBe(true);
    for (const member of marked.filter((member) => member.personId !== first.personId)) {
      expect(member.away).toBe(false);
    }
    // Never the note: it is the crew member's own business.
    expect(JSON.stringify(marked)).not.toContain("Family trip");
  });

  it("marks nobody for days away that the departure does not meet on", async () => {
    const { db, shop, trip, crew } = await aCrewedDeparture();
    const [first] = crew;
    if (!first) throw new Error("expected a named crew member");
    await away(first.personId, "2099-01-01", "2099-01-02");
    const marked = await diverCrewWithAway(db, shop.id, trip, shop.timezone);
    expect(marked.every((member) => member.away === false)).toBe(true);
    expect(marked.map((member) => member.personId)).toEqual(crew.map((member) => member.personId));
  });

  it("names nobody for another shop's departure", async () => {
    const { db, shop, trip } = await aCrewedDeparture();
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(await diverCrewWithAway(db, otherShop, trip, shop.timezone)).toEqual([]);
  });
});
