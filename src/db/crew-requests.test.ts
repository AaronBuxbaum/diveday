import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { seededShopContext } from "@/test/db";
import {
  decideCrewAssignmentRequest,
  deleteCrewAvailabilityBlock,
  listCrewAssignmentRequests,
  listCrewAvailabilityBlocks,
  requestCrewAssignment,
  saveCrewAvailabilityBlock,
  withdrawCrewAssignmentRequest,
} from "./crew-requests";
import { crewAssignmentRequests, crewAvailabilityBlocks, people, personRoles } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { getTripCrewIds, listStaff } from "./trips-crew";

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
