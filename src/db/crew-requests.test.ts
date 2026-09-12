import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  decideCrewAssignmentRequest,
  deleteCrewAvailabilityBlock,
  listCrewAssignmentRequests,
  listCrewAvailabilityBlocks,
  requestCrewAssignment,
  saveCrewAvailabilityBlock,
  tripOverIntroRatio,
  withdrawCrewAssignmentRequest,
} from "./crew-requests";
import {
  bookings,
  courses,
  crewAssignmentRequests,
  crewAvailabilityBlocks,
  people,
  personRoles,
} from "./schema";
import { createTrip, setTripCrew, upcomingTripsWithCounts } from "./trips";
import { changeTripCrew, getTripCrewIds, listStaff } from "./trips-crew";

const now = new Date("2026-07-18T12:00:00.000Z");

async function context() {
  const { db, shop } = await seededShopContext();
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((row) => row.roles.includes("owner"));
  const crew = staff.find((row) => !row.roles.includes("owner") && !row.roles.includes("manager"));
  if (!owner || !crew) throw new Error("demo staff missing an owner or a crew member");
  const [trip] = await upcomingTripsWithCounts(db, shop.id, now);
  if (!trip) throw new Error("demo trip missing");
  return { db, shop, owner: owner.person, crew: crew.person, trip };
}

/** A live person of this shop who is not staff — the classic wrong actor. */
async function diverPerson(db: Awaited<ReturnType<typeof context>>["db"], shopId: string) {
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: "Just A Diver", email: `diver-${randomUUID()}@x.test` })
    .returning();
  await db.insert(personRoles).values({ personId: person.id, role: "diver" });
  return person;
}

/**
 * **A crew member writes their own rows and nobody else's** (issue #1235, ADR
 * 20260902-crew-requests-and-blackouts, decision 4).
 *
 * This is the property the whole slice rests on: the staffing week gained a
 * second author, and every one of these refusals is what stops that author
 * reaching past their own row.
 */
describe("crew availability blocks", () => {
  it("lets a crew member record their own days away", async () => {
    const { db, shop, crew } = await context();
    const outcome = await saveCrewAvailabilityBlock(db, {
      shopId: shop.id,
      personId: crew.id,
      actorPersonId: crew.id,
      canManageRoster: false,
      startsOn: "2026-07-20",
      endsOn: "2026-07-22",
      note: "Family",
    });
    expect(outcome.ok).toBe(true);

    // Scoped to this person: the demo shop seeds a blackout of its own
    // (`seedCrewAway`), which is the point of the reader but not of this test.
    const blocks = (
      await listCrewAvailabilityBlocks(db, shop.id, { from: "2026-07-20", to: "2026-07-26" })
    ).filter((block) => block.personId === crew.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ personId: crew.id, startsOn: "2026-07-20", note: "Family" });
  });

  it("refuses a crew member writing somebody else's days", async () => {
    const { db, shop, crew, owner } = await context();
    const outcome = await saveCrewAvailabilityBlock(db, {
      shopId: shop.id,
      personId: owner.id,
      actorPersonId: crew.id,
      canManageRoster: false,
      startsOn: "2026-07-20",
      endsOn: "2026-07-20",
    });
    expect(outcome).toEqual({ ok: false, reason: "not_allowed" });
    // Nothing landed on the owner's row. (The shop's seeded blackout belongs to
    // whichever staff person `seedCrewAway` picked, so this is scoped rather
    // than asserting the table is empty.)
    expect(
      (
        await listCrewAvailabilityBlocks(db, shop.id, { from: "2026-07-01", to: "2026-12-31" })
      ).filter((block) => block.startsOn === "2026-07-20"),
    ).toEqual([]);
  });

  it("lets somebody who manages the roster record it for a person who phoned in", async () => {
    const { db, shop, crew, owner } = await context();
    const outcome = await saveCrewAvailabilityBlock(db, {
      shopId: shop.id,
      personId: crew.id,
      actorPersonId: owner.id,
      canManageRoster: true,
      startsOn: "2026-07-20",
      endsOn: "2026-07-20",
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a person who is not this shop's staff at all", async () => {
    const { db, shop } = await context();
    const diver = await diverPerson(db, shop.id);
    const outcome = await saveCrewAvailabilityBlock(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: diver.id,
      canManageRoster: false,
      startsOn: "2026-07-20",
      endsOn: "2026-07-20",
    });
    expect(outcome).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("refuses a range that ends before it starts", async () => {
    const { db, shop, crew } = await context();
    expect(
      await saveCrewAvailabilityBlock(db, {
        shopId: shop.id,
        personId: crew.id,
        actorPersonId: crew.id,
        canManageRoster: false,
        startsOn: "2026-07-22",
        endsOn: "2026-07-20",
      }),
    ).toEqual({ ok: false, reason: "invalid_range" });
  });

  it("deletes softly, and only ever your own", async () => {
    const { db, shop, crew, owner } = await context();
    const saved = await saveCrewAvailabilityBlock(db, {
      shopId: shop.id,
      personId: crew.id,
      actorPersonId: crew.id,
      canManageRoster: false,
      startsOn: "2026-07-20",
      endsOn: "2026-07-20",
    });
    if (!saved.ok) throw new Error("expected a saved block");

    // The owner is not this row's person, but they manage the roster.
    const byOwner = await deleteCrewAvailabilityBlock(db, {
      shopId: shop.id,
      blockId: saved.id,
      actorPersonId: owner.id,
      canManageRoster: true,
      now,
    });
    expect(byOwner.ok).toBe(true);
    // Gone from every live read, and still on the row. (Scoped past the shop's
    // own seeded blackout, as above.)
    expect(
      (await listCrewAvailabilityBlocks(db, shop.id, { from: "2026-07-01", to: "2026-12-31" })).map(
        (block) => block.id,
      ),
    ).not.toContain(saved.id);
    const [row] = await db
      .select()
      .from(crewAvailabilityBlocks)
      .where(eq(crewAvailabilityBlocks.id, saved.id));
    expect(row.deletedAt).toEqual(now);
  });
});

describe("crew assignment requests", () => {
  it("records an ask and reads it back as pending", async () => {
    const { db, shop, crew, trip } = await context();
    const outcome = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    expect(outcome.ok).toBe(true);
    const requests = await listCrewAssignmentRequests(db, shop.id, [trip.id]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ personId: crew.id, state: "pending" });
  });

  /**
   * Issue #1339. The person who answers a request is not the person who made
   * it, and the queue handed them a name and two buttons — so a manager could
   * approve a divemaster onto an over-ratio intro session and read "Approved,
   * and they're on the crew" about a boat that had not moved a seat. What the
   * requester would be worth in the water travels with the ask.
   */
  it("carries what each requester would contribute in the water", async () => {
    const { db, shop, trip } = await context();
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((row) => row.roles.includes("instructor"));
    const divemaster = staff.find(
      (row) => row.roles.includes("divemaster") && !row.roles.includes("instructor"),
    );
    if (!instructor || !divemaster) throw new Error("demo staff missing an instructor or a DM");
    for (const person of [instructor.person, divemaster.person]) {
      expect(
        await requestCrewAssignment(db, {
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
          actorPersonId: person.id,
          now,
        }),
      ).toMatchObject({ ok: true });
    }
    const byPerson = new Map(
      (await listCrewAssignmentRequests(db, shop.id, [trip.id])).map((request) => [
        request.personId,
        request.inWaterRole,
      ]),
    );
    // The ask names a departure, never a job on it, so this is the shop-wide
    // inference — and it is the one the assignment itself will land with.
    expect(byPerson.get(instructor.person.id)).toBe("instructor");
    expect(byPerson.get(divemaster.person.id)).toBe("certified_assistant");
    // One row per person, not one per role they hold: the roles are read by a
    // second query for exactly this reason.
    expect(byPerson.size).toBe(2);
  });

  it("refuses an ask made on somebody else's behalf, even by the owner", async () => {
    const { db, shop, crew, owner, trip } = await context();
    // A request is a statement about what *you* want to work, so roster rights
    // buy nothing here — this is the one write a manager cannot make for
    // somebody (ADR 20260902, decision 4).
    const outcome = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: owner.id,
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "not_allowed" });
    expect(await listCrewAssignmentRequests(db, shop.id, [trip.id])).toEqual([]);
  });

  it("treats a second tap as the same ask", async () => {
    const { db, shop, crew, trip } = await context();
    const first = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    const second = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    expect(first).toEqual(second);
    expect(await listCrewAssignmentRequests(db, shop.id, [trip.id])).toHaveLength(1);
  });

  it("never reaches another shop's departure", async () => {
    const { db, shop, crew } = await context();
    const outcome = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: randomUUID(),
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "trip_not_found" });
  });

  it("withdraws softly, and only your own", async () => {
    const { db, shop, crew, owner, trip } = await context();
    const asked = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    if (!asked.ok) throw new Error("expected a request");

    expect(
      await withdrawCrewAssignmentRequest(db, {
        shopId: shop.id,
        requestId: asked.id,
        actorPersonId: owner.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });

    expect(
      await withdrawCrewAssignmentRequest(db, {
        shopId: shop.id,
        requestId: asked.id,
        actorPersonId: crew.id,
        now,
      }),
    ).toMatchObject({ ok: true });
    expect(await listCrewAssignmentRequests(db, shop.id, [trip.id])).toEqual([]);
  });

  it("refuses a decision from somebody who does not manage the roster", async () => {
    const { db, shop, crew, trip } = await context();
    const asked = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    if (!asked.ok) throw new Error("expected a request");
    // The sharp case: the asker approving their own ask.
    expect(
      await decideCrewAssignmentRequest(db, {
        shopId: shop.id,
        requestId: asked.id,
        decision: "approved",
        decidedByPersonId: crew.id,
        canManageRoster: false,
        now,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    const [row] = await db
      .select()
      .from(crewAssignmentRequests)
      .where(eq(crewAssignmentRequests.id, asked.id));
    expect(row.decision).toBeNull();
  });

  it("stamps a decision and assigns nobody — that is the caller's own act", async () => {
    const { db, shop, crew, owner, trip } = await context();
    const before = await getTripCrewIds(db, shop.id, trip.id);
    const asked = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    if (!asked.ok) throw new Error("expected a request");

    const decided = await decideCrewAssignmentRequest(db, {
      shopId: shop.id,
      requestId: asked.id,
      decision: "approved",
      decidedByPersonId: owner.id,
      canManageRoster: true,
      now,
    });
    expect(decided).toMatchObject({ ok: true, tripId: trip.id, personId: crew.id });
    // **The point of the model**: approving records a decision. The assignment
    // goes through `changeTripCrew`, where the ratio and the course rules live,
    // and nothing here writes a `trip_assignments` row.
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual(before);
  });

  it("keeps the first answer rather than letting a double tap rewrite it", async () => {
    const { db, shop, crew, owner, trip } = await context();
    const asked = await requestCrewAssignment(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      actorPersonId: crew.id,
      now,
    });
    if (!asked.ok) throw new Error("expected a request");
    await decideCrewAssignmentRequest(db, {
      shopId: shop.id,
      requestId: asked.id,
      decision: "declined",
      decidedByPersonId: owner.id,
      canManageRoster: true,
      now,
    });
    await decideCrewAssignmentRequest(db, {
      shopId: shop.id,
      requestId: asked.id,
      decision: "approved",
      decidedByPersonId: owner.id,
      canManageRoster: true,
      now: new Date(now.getTime() + 1000),
    });
    const [row] = await db
      .select()
      .from(crewAssignmentRequests)
      .where(
        and(eq(crewAssignmentRequests.id, asked.id), eq(crewAssignmentRequests.shopId, shop.id)),
      );
    expect(row.decision).toBe("declined");
    expect(row.decidedAt).toEqual(now);
  });
});

/**
 * 180 days out, matching src/db/staffing.test.ts's reasoning: far enough past
 * the seeded demo's instructor calendar that a synthetic session never collides
 * with the seed's real crew overlaps.
 */
const OPEN_TEST_SESSION_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Issue #1339's approval notice. `INTRO_COURSE_RATIO` credits a certified
 * assistant zero students, so approving a divemaster onto an over-ratio intro
 * session is a real assignment that moves capacity by not one seat — and the
 * plain "Approved, and they're on the crew" was the last thing the queue said
 * about it. The action asks the boat rather than inferring from who asked.
 */
describe("tripOverIntroRatio", () => {
  /**
   * An instructor-crewed session on `courseTitle`, seated `withinRatio` through
   * the booking gate and then pushed one over by a row written directly —
   * `createBooking` refuses to *sell* the seat past the ratio, and the state
   * this reports on is one a data import or a crew change leaves behind.
   */
  async function overRatioSession(courseTitle: string, withinRatio: number, tag: string) {
    const { db, shop } = await seededShopContext();
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, courseTitle)));
    if (!course) throw new Error(`${courseTitle} course missing`);
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: `Ratio session (${tag})`,
      startsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 20,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create ratio test trip");
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);
    for (let i = 0; i < withinRatio; i++) {
      expect(
        await createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          fullName: `Ratio Diver ${i}`,
          email: `crew-request-${tag}-diver-${i}@example.com`,
        }),
      ).toMatchObject({ ok: true });
    }
    const [extraDiver] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: `Ratio Diver ${withinRatio}`,
        email: `crew-request-${tag}-diver-${withinRatio}@example.com`,
      })
      .returning();
    if (!extraDiver) throw new Error("failed to insert extra diver");
    await db.insert(bookings).values({ shopId: shop.id, tripId: trip.id, personId: extraDiver.id });
    return { db, shop, trip };
  }

  it("says an over-ratio intro session is still over it, and a divemaster does not change that", async () => {
    const { db, shop, trip } = await overRatioSession("Discover Scuba Diving", 2, "dsd-notice");
    expect(await tripOverIntroRatio(db, shop.id, trip.id)).toBe(true);

    // The approval the notice is about: a real assignment that buys the cap
    // nothing, because the intro rule credits an assistant zero students.
    const divemaster = (await listStaff(db, shop.id)).find(
      (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
    );
    if (!divemaster) throw new Error("seeded divemaster missing");
    await changeTripCrew(db, shop.id, trip.id, {
      operation: "assign",
      personId: divemaster.person.id,
    });
    expect(await tripOverIntroRatio(db, shop.id, trip.id)).toBe(true);
  });

  it("stays quiet for the entry-level cap and for a session inside its ratio", async () => {
    // Over ratio, but the entry-level one — a certified assistant does raise
    // that, so the plain success line is the honest answer there.
    const entryLevel = await overRatioSession("Open Water Diver", 8, "ow-notice");
    expect(await tripOverIntroRatio(entryLevel.db, entryLevel.shop.id, entryLevel.trip.id)).toBe(
      false,
    );

    // And a fun dive, which carries no course ratio at all.
    const { db, shop, trip } = await context();
    expect(await tripOverIntroRatio(db, shop.id, trip.id)).toBe(false);
  });
});
