// @vitest-environment node
import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings, people, trips } from "@/db/schema";
import { listStaff, setTripCrew } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { BOARD_DEPARTURE_KEYS, getDeparturesBoard } from "./departures-board";
import { recordRollCall } from "./manifests";
import { recordTripStage } from "./trip-stages";

const REEF_TRIP = "Two-Tank Reef — Molasses & French";

async function todayBoard(showNames = false) {
  const { db, shop } = await seededShopContext();
  const board = await getDeparturesBoard(db, {
    shopId: shop.id,
    timeZone: shop.timezone,
    showNames,
  });
  const reef = board.find((row) => row.title === REEF_TRIP);
  if (!reef) throw new Error("the seeded today boat is missing from the board");
  return { db, shop, board, reef };
}

describe("getDeparturesBoard", () => {
  it("lists today's scheduled departures in clock order, seats counted like the schedule", async () => {
    const { board, reef } = await todayBoard();
    expect(board.length).toBeGreaterThan(0);
    const times = board.map((row) => row.startsAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(reef.capacity).toBe(12);
    expect(reef.booked).toBeGreaterThan(0);
    expect(reef.booked).toBeLessThanOrEqual(reef.capacity);
    expect(reef.siteName).toBe("Molasses Reef");
  });

  it("carries exactly the keys a lobby may see — the shape is closed", async () => {
    const { board } = await todayBoard(true);
    const allowed = [...BOARD_DEPARTURE_KEYS].sort();
    for (const row of board) {
      expect(Object.keys(row).sort()).toEqual(allowed);
      if (row.stage)
        expect(Object.keys(row.stage).sort()).toEqual(["recordedAt", "siteName", "stage"]);
    }
  });

  it("names nobody unless the link says names, and never a diver either way", async () => {
    const { db, shop, reef } = await todayBoard();
    expect(reef.crewNames).toEqual([]);

    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("seeded shop has no owner");
    await setTripCrew(db, shop.id, reef.tripId, [owner.person.id]);

    const [diver] = await db
      .select({ fullName: people.fullName })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.tripId, reef.tripId), eq(bookings.status, "booked")))
      .limit(1);
    if (!diver) throw new Error("the seeded today boat has no booked diver");

    const named = await getDeparturesBoard(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      showNames: true,
    });
    expect(JSON.stringify(named)).not.toContain(diver.fullName);
  });

  /**
   * `show_names` is the owner's decision that a screen may carry names; it is
   * not anybody's decision that theirs is one of them. That second one lives in
   * `people.crew_public_consent_at`, which `setCrewPublicConsent` refuses to
   * record for anybody but its own subject, and the seeded cast has two of five
   * who agreed. A board link is read by everyone in the room and by anyone the
   * URL reaches afterwards, so somebody who declined has to read exactly like
   * somebody who was never rostered.
   */
  it("names only the crew who agreed to it, by the name they chose", async () => {
    const { db, shop, reef } = await todayBoard();

    const staff = await listStaff(db, shop.id);
    const declined = staff.find((entry) => entry.roles.includes("owner"));
    if (!declined) throw new Error("seeded shop has no owner");

    const [agreed] = await db
      .select({ id: people.id, publicName: people.crewPublicName, fullName: people.fullName })
      .from(people)
      .where(and(eq(people.shopId, shop.id), isNotNull(people.crewPublicConsentAt)))
      .limit(1);
    if (!agreed?.publicName) throw new Error("the seeded cast names nobody to divers");

    await setTripCrew(db, shop.id, reef.tripId, [declined.person.id, agreed.id]);
    const named = await getDeparturesBoard(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      showNames: true,
    });
    const namedReef = named.find((row) => row.tripId === reef.tripId);

    expect(namedReef?.crewNames).toEqual([agreed.publicName]);
    // Their record still reads "Tanaka Keiko"; the board may say only "Keiko".
    // Publishing the surname is the bug issue #1351 closed on the departure
    // page, and it would arrive here by a second door.
    expect(JSON.stringify(named)).not.toContain(agreed.fullName);
    expect(JSON.stringify(named)).not.toContain(declined.person.fullName);
  });

  it("counts the boarded from the roll call, not from bookings", async () => {
    const { db, shop, reef } = await todayBoard();
    expect(reef.boarded).toBe(0);
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, reef.tripId), eq(bookings.status, "booked")))
      .limit(1);
    if (!owner || !booking) throw new Error("seed is missing an owner or a booking");

    const outcome = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.tripId,
      bookingId: booking.id,
      recordedByPersonId: owner.person.id,
      status: "boarded",
    });
    expect(outcome.ok).toBe(true);

    const after = await getDeparturesBoard(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      showNames: false,
    });
    expect(after.find((row) => row.tripId === reef.tripId)?.boarded).toBe(1);
  });

  it("carries the crew's stage word without who said it", async () => {
    const { db, shop, reef } = await todayBoard();
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("seeded shop has no owner");
    const recorded = await recordTripStage(db, {
      shopId: shop.id,
      tripId: reef.tripId,
      stage: "boarding",
      recordedByPersonId: owner.person.id,
      recordedAt: nowDate(),
    });
    expect(recorded.ok).toBe(true);

    const after = await getDeparturesBoard(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      showNames: false,
    });
    const row = after.find((entry) => entry.tripId === reef.tripId);
    expect(row?.stage?.stage).toBe("boarding");
    expect(JSON.stringify(row)).not.toContain(owner.person.fullName);
  });

  it("keeps a private charter on the board, flagged, and drops a cancelled one", async () => {
    const { db, shop, reef, board } = await todayBoard();
    await db.update(trips).set({ isPrivate: true }).where(eq(trips.id, reef.tripId));
    const other = board.find((row) => row.tripId !== reef.tripId);
    if (other) {
      await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, other.tripId));
    }

    const after = await getDeparturesBoard(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      showNames: false,
    });
    expect(after.find((row) => row.tripId === reef.tripId)?.isPrivate).toBe(true);
    if (other) expect(after.some((row) => row.tripId === other.tripId)).toBe(false);
  });

  it("answers another shop's id with nothing", async () => {
    const { db } = await todayBoard();
    expect(
      await getDeparturesBoard(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        timeZone: "UTC",
        showNames: true,
      }),
    ).toEqual([]);
  });
});
