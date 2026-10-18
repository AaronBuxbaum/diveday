import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { crewAwayByTrip } from "./crew-away";
import {
  acknowledgeCrewAway,
  listCrewAwayAcknowledgements,
  withdrawCrewAwayAcknowledgement,
} from "./crew-away-acknowledgements";
import { saveCrewAvailabilityBlock } from "./crew-requests";
import { loadShopExportBundleInput } from "./export";
import { crewAvailabilityBlocks, crewAwayAcknowledgements } from "./schema";
import { changeTripCrew, createTrip, listStaff, moveTrip, setTripCrew, updateTrip } from "./trips";

const ctx = fileScopedShopContext();
const HOUR = 60 * 60 * 1000;

/**
 * **"Working it anyway"** (issue #2678): a staffer's acknowledgement on one
 * crew assignment, tied to the days away it answered (security review MEDIUM,
 * dock review S2/S3, records review N3/N4). Refused unless the person is away
 * on a day the departure meets, never said by the person about themself, not
 * covering a day away told after it, gone when the person comes off the crew
 * or the departure's dates move, and taken back with who took it back.
 */
async function rostered(title: string, startsAt: string, hours = 4) {
  const { db, shop } = ctx;
  const staff = await listStaff(db, shop.id);
  const instructor = staff.find((entry) => entry.roles.includes("instructor"))?.person;
  const captain = staff.find((entry) => entry.roles.includes("captain"))?.person;
  const owner = staff.find((entry) => entry.roles.includes("owner"))?.person;
  if (!instructor || !captain || !owner) throw new Error("seeded staff missing");
  const starts = new Date(startsAt);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title,
    startsAt: starts,
    endsAt: new Date(starts.getTime() + hours * HOUR),
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
  return { trip, instructor, captain, owner };
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

function acknowledge(tripId: string, personId: string, actorPersonId: string) {
  const { db, shop } = ctx;
  return acknowledgeCrewAway(db, { shopId: shop.id, tripId, personId, actorPersonId });
}

async function acknowledgedOn(tripId: string, personId: string) {
  const { db, shop } = ctx;
  const entry = (await crewAwayByTrip(db, shop.id, [tripId], shop.timezone))
    .get(tripId)
    ?.find((person) => person.personId === personId);
  return entry?.acknowledged;
}

async function liveAcks(tripId: string) {
  const { db } = ctx;
  return db
    .select()
    .from(crewAwayAcknowledgements)
    .where(
      and(eq(crewAwayAcknowledgements.tripId, tripId), isNull(crewAwayAcknowledgements.deletedAt)),
    );
}

describe("acknowledgeCrewAway", () => {
  it("marks the acknowledged person on that departure only, and leaves their block alone", async () => {
    const { db } = ctx;
    const sunday = await rostered("Ack Sunday", "2027-06-13T15:00:00Z");
    const saturday = await rostered("Ack Saturday", "2027-06-12T15:00:00Z");
    await away(sunday.instructor.id, "2027-06-12", "2027-06-13");
    expect(await acknowledge(sunday.trip.id, sunday.instructor.id, sunday.owner.id)).toBe("saved");
    // Twice is one row, and still saved.
    expect(await acknowledge(sunday.trip.id, sunday.instructor.id, sunday.owner.id)).toBe("saved");
    expect(await liveAcks(sunday.trip.id)).toHaveLength(1);
    expect(await acknowledgedOn(sunday.trip.id, sunday.instructor.id)).toBe(true);
    expect(await acknowledgedOn(saturday.trip.id, sunday.instructor.id)).toBe(false);
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
    const { trip, captain, owner } = await rostered("Ack refusals", "2027-06-20T15:00:00Z");
    await away(captain.id, "2027-06-20", "2027-06-20");
    const staff = await listStaff(db, shop.id);
    const offCrew = staff.find(
      (entry) =>
        !entry.roles.includes("instructor") &&
        !entry.roles.includes("captain") &&
        entry.person.id !== owner.id,
    )?.person;
    if (!offCrew) throw new Error("seeded staff missing an off-crew member");
    expect(await acknowledge(trip.id, offCrew.id, owner.id)).toBe("not_on_crew");
    expect(
      await acknowledgeCrewAway(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        tripId: trip.id,
        personId: captain.id,
        actorPersonId: owner.id,
      }),
    ).toBe("not_on_crew");
    expect(await liveAcks(trip.id)).toEqual([]);
  });

  it("refuses a person who is not away on a day the departure meets", async () => {
    const { trip, instructor, owner } = await rostered("Ack not away", "2027-07-04T15:00:00Z");
    // Away the day after: nothing to acknowledge on this departure.
    await away(instructor.id, "2027-07-05", "2027-07-05");
    expect(await acknowledge(trip.id, instructor.id, owner.id)).toBe("not_away");
    expect(await liveAcks(trip.id)).toEqual([]);
  });

  it("refuses the person saying it about themself", async () => {
    const { trip, instructor } = await rostered("Ack self", "2027-07-11T15:00:00Z");
    await away(instructor.id, "2027-07-11", "2027-07-11");
    expect(await acknowledge(trip.id, instructor.id, instructor.id)).toBe("own_away");
    expect(await liveAcks(trip.id)).toEqual([]);
    expect(await acknowledgedOn(trip.id, instructor.id)).toBe(false);
  });

  it("does not cover a day away told after it, until it is said again", async () => {
    // Two days: Sat Jul 17 and Sun Jul 18 in the shop's zone.
    const { trip, instructor, owner } = await rostered(
      "Ack later block",
      "2027-07-17T15:00:00Z",
      24,
    );
    await away(instructor.id, "2027-07-17", "2027-07-17");
    expect(await acknowledge(trip.id, instructor.id, owner.id)).toBe("saved");
    expect(await acknowledgedOn(trip.id, instructor.id)).toBe(true);
    advanceClock();
    await away(instructor.id, "2027-07-18", "2027-07-18");
    expect(await acknowledgedOn(trip.id, instructor.id)).toBe(false);
    advanceClock();
    expect(await acknowledge(trip.id, instructor.id, owner.id)).toBe("saved");
    expect(await acknowledgedOn(trip.id, instructor.id)).toBe(true);
    expect(await liveAcks(trip.id)).toHaveLength(1);
  });

  it("goes with the person when they come off the crew, either way they are taken off", async () => {
    const { db, shop } = ctx;
    const { trip, instructor, captain, owner } = await rostered(
      "Ack cleared",
      "2027-06-27T15:00:00Z",
    );
    await away(instructor.id, "2027-06-27", "2027-06-27");
    await away(captain.id, "2027-06-27", "2027-06-27");
    for (const person of [instructor, captain]) {
      expect(await acknowledge(trip.id, person.id, owner.id)).toBe("saved");
    }
    // One taken off by a single change, then the whole crew rewritten.
    expect(
      await changeTripCrew(db, shop.id, trip.id, { operation: "unassign", personId: captain.id }),
    ).toBe(true);
    expect(
      await setTripCrew(db, shop.id, trip.id, [{ personId: captain.id, tripRole: "captain" }]),
    ).toBe(true);
    expect(await liveAcks(trip.id)).toEqual([]);
    // Back on the crew, the captain starts unconfirmed.
    expect(await acknowledgedOn(trip.id, captain.id)).toBe(false);
  });

  it("goes when the departure moves, and stays through an edit that keeps its times", async () => {
    const { db, shop } = ctx;
    const { trip, instructor, owner } = await rostered("Ack moved", "2027-08-01T15:00:00Z");
    await away(instructor.id, "2027-08-01", "2027-08-02");
    expect(await acknowledge(trip.id, instructor.id, owner.id)).toBe("saved");

    const kept = await updateTrip(db, shop.id, trip.id, {
      title: "Ack moved, renamed",
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
    });
    expect(kept.ok).toBe(true);
    expect(await liveAcks(trip.id)).toHaveLength(1);

    const later = new Date(trip.startsAt.getTime() + HOUR);
    const edited = await updateTrip(db, shop.id, trip.id, {
      title: "Ack moved, renamed",
      startsAt: later,
      endsAt: new Date(trip.endsAt.getTime() + HOUR),
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
    });
    expect(edited.ok).toBe(true);
    expect(await liveAcks(trip.id)).toEqual([]);

    // Said again, then moved on the schedule board: gone again.
    expect(await acknowledge(trip.id, instructor.id, owner.id)).toBe("saved");
    const moved = await moveTrip(db, shop.id, trip.id, new Date("2027-08-02T15:00:00Z"));
    expect(moved.ok).toBe(true);
    expect(await liveAcks(trip.id)).toEqual([]);
    expect(await acknowledgedOn(trip.id, instructor.id)).toBe(false);
  });
});

describe("withdrawCrewAwayAcknowledgement", () => {
  it("takes it back, records who did, and the warning returns", async () => {
    const { db, shop } = ctx;
    const { trip, instructor, captain, owner } = await rostered(
      "Ack withdrawn",
      "2027-08-15T15:00:00Z",
    );
    await away(instructor.id, "2027-08-15", "2027-08-15");
    expect(await acknowledge(trip.id, instructor.id, owner.id)).toBe("saved");
    expect(await listCrewAwayAcknowledgements(db, shop.id, trip.id)).toEqual([
      expect.objectContaining({ personId: instructor.id, acknowledgedByName: owner.fullName }),
    ]);

    const input = { shopId: shop.id, tripId: trip.id, personId: instructor.id };
    expect(await withdrawCrewAwayAcknowledgement(db, { ...input, actorPersonId: captain.id })).toBe(
      "cleared",
    );
    expect(await acknowledgedOn(trip.id, instructor.id)).toBe(false);
    expect(await listCrewAwayAcknowledgements(db, shop.id, trip.id)).toEqual([]);
    const [row] = await db
      .select()
      .from(crewAwayAcknowledgements)
      .where(eq(crewAwayAcknowledgements.tripId, trip.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.clearedByPersonId).toBe(captain.id);
    // The export keeps the trail, taken back and by whom (records review S2).
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const file = bundle?.tables.find((table) => table.file === "crew_away_acknowledgements.csv");
    if (!file) throw new Error("crew_away_acknowledgements.csv missing from the export");
    const cell = (exported: unknown[], column: string) => exported[file.header.indexOf(column)];
    const exported = file.rows.find((candidate) => cell(candidate, "trip_id") === trip.id);
    expect(exported && cell(exported, "acknowledged_by_name")).toBe(owner.fullName);
    expect(exported && cell(exported, "deleted_at")).not.toBeNull();
    expect(exported && cell(exported, "cleared_by_person_id")).toBe(captain.id);
    // Nothing left to take back, and never another shop's.
    expect(await withdrawCrewAwayAcknowledgement(db, { ...input, actorPersonId: captain.id })).toBe(
      "not_found",
    );
  });
});
