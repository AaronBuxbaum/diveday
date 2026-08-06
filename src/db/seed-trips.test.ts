import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inWaterCrewRole } from "@/lib/crew-roles";
import { seededShopContext } from "@/test/db";
import { people, personRoles, tripAssignments, trips } from "./schema";
import { LEAD_INSTRUCTOR_NAME, RELIEF_INSTRUCTOR_NAME } from "./seed-cast";

/**
 * DOM-M7 (review 20260802). `crew-roles.test.ts` asserts the rule abstractly —
 * a per-trip role can only narrow what a person is worth to the in-water ratio,
 * never widen it — and the seed showed every (shop role × trip role) pair it
 * produces except the one that matters most for reading the rule: an
 * **instructor rostered as a session's divemaster**. That is the genuine
 * downgrade, and it was unseedable while the demo shop had a single instructor,
 * because rostering him as somebody's assistant leaves the class unstaffed.
 *
 * This test is the guard on the shape the demo, the screenshots, and any future
 * reading of the crew rule depend on. It is deliberately about the *pair*, not
 * about Talia: drop her, rename the session, or "tidy" her role to divemaster
 * on `person_roles`, and the combination silently stops being demonstrated.
 */
describe("seeded crew — every shop role × trip role combination", () => {
  it("rosters the second instructor as a session's divemaster", async () => {
    const { db, shop } = await seededShopContext();

    const staff = await db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .where(
        and(
          eq(people.shopId, shop.id),
          inArray(people.fullName, [LEAD_INSTRUCTOR_NAME, RELIEF_INSTRUCTOR_NAME]),
        ),
      );
    const relief = staff.find((row) => row.fullName === RELIEF_INSTRUCTOR_NAME);
    const lead = staff.find((row) => row.fullName === LEAD_INSTRUCTOR_NAME);
    if (!relief || !lead) throw new Error("expected both seeded instructors");

    // She holds the instructor role shop-wide. If this ever narrows to
    // "divemaster" the assignment below stops being the DOM-M7 case and becomes
    // an ordinary divemaster on a boat.
    const reliefRoles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, relief.id));
    expect(reliefRoles.map((row) => row.role)).toEqual(["instructor"]);

    const assignments = await db
      .select({ tripId: tripAssignments.tripId, tripRole: tripAssignments.tripRole })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(and(eq(trips.shopId, shop.id), eq(tripAssignments.personId, relief.id)));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].tripRole).toBe("divemaster");

    // On a course session, and one whose instructor of record is still the lead
    // — the point of the second instructor is that assisting costs the class
    // nothing.
    const [session] = await db
      .select({ courseId: trips.courseId })
      .from(trips)
      .where(eq(trips.id, assignments[0].tripId));
    expect(session.courseId).not.toBeNull();
    const sessionCrew = await db
      .select({ personId: tripAssignments.personId, tripRole: tripAssignments.tripRole })
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, assignments[0].tripId));
    expect(sessionCrew).toContainEqual({ personId: lead.id, tripRole: "instructor" });

    // And the rule the whole thing exists to make visible: she is a certified
    // assistant on this sailing, not an instructor, even though she is one.
    expect(inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["instructor"] })).toBe(
      "certified_assistant",
    );
  });

  it("seeds exactly two instructors, so the lead is never ambiguous", async () => {
    // `seedDemoSchedule` resolves both by name because a bare
    // `where role = 'instructor' limit 1` has no ordering and would pick either
    // one. A third instructor is fine to add — but it has to be named there
    // too, and this is where that gets noticed.
    const { db, shop } = await seededShopContext();
    const instructors = await db
      .select({ fullName: people.fullName })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "instructor")));
    expect(instructors.map((row) => row.fullName).sort()).toEqual(
      [LEAD_INSTRUCTOR_NAME, RELIEF_INSTRUCTOR_NAME].sort(),
    );
  });
});
