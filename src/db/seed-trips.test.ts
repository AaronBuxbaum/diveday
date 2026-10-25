import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inWaterCrewRole } from "@/lib/crew-roles";
import { seededShopContext } from "@/test/db";
import { people, personRoles, tripAssignments, trips } from "./schema";
import { LEAD_INSTRUCTOR_NAME, RELIEF_INSTRUCTOR_NAME } from "./seed-cast";
import { crewClashes, setTripCrew } from "./trips-crew";
import { listUpcomingSessionsForCourse } from "./trips-queries";
import { tripPublicCrew } from "./trips-record";

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

    // She holds the instructor role shop-wide (and captain, for the weekly boat's
    // relief, issue #2685). If instructor ever narrows to "divemaster" the
    // assignment below stops being the DOM-M7 case and becomes an ordinary
    // divemaster on a boat.
    const reliefRoles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, relief.id));
    expect(reliefRoles.map((row) => row.role).sort()).toEqual(["captain", "instructor"]);

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

/**
 * **The pair the Move panel's clash capture lands on** (issue #1688).
 *
 * The board's move preview draws its loudest line — one `role="alert"` per
 * person who would be on two boats at once — only when the target hours overlap
 * a departure that shares crew. The capture types the Christ of the Abyss
 * window into the wreck charter's Move panel, and that only says anything
 * because the seed rosters the same captain and divemaster on both.
 *
 * Asserted here rather than left for the capture to discover: a capture that
 * quietly lands on the calm state photographs nothing and fails nothing, which
 * is exactly how a visual baseline stops being evidence.
 */
describe("seeded charters share their crew", () => {
  it("puts the same two people on the wreck charter and the Christ of the Abyss reef day", async () => {
    const { db, shop } = await seededShopContext();
    const titles = ["Wreck Trip — Spiegel Grove", "Two-Tank Reef — Christ of the Abyss"];

    const rows = await db
      .select({ title: trips.title, personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(and(eq(trips.shopId, shop.id), inArray(trips.title, titles)));

    const crewOf = (title: string) =>
      new Set(rows.filter((row) => row.title === title).map((row) => row.personId));
    const mover = crewOf(titles[0] as string);
    const host = crewOf(titles[1] as string);
    // The wreck charter also carries the assistant instructor in the water;
    // the Christ of the Abyss day is the DOM-M3 charter and does not.
    expect(mover.size).toBe(3);
    expect(host.size).toBe(2);
    // Both, not one: the block draws a line per person, and the capture counts
    // two.
    expect([...mover].filter((personId) => host.has(personId))).toHaveLength(2);
  });
});

/**
 * **Nobody on the demo board is on two hulls at once.**
 *
 * The seed writes `trip_assignments` from four independent modules
 * (`seed-more-trips`, `seed-counter-blockers`, `seed-minimum-seats`,
 * `seed-cert-gates`), and none of them can see what the others rostered. Every
 * constraint `setTripCrew` enforces is therefore one the fixture can violate
 * without anybody noticing until a reader is built that looks — and crew
 * overlap was the first such reader (`crewClashes`, issue #1695), which found
 * ten standing clashes across seven seeded departures the day it shipped.
 *
 * A prospective customer opening the demo met ten warnings about physically
 * impossible rosters. Every one was true, which is why the answer was the
 * fixture and never the predicate: a reader taught to look away here would look
 * away at a real shop too.
 *
 * This walks the whole board rather than the three days that were wrong, so the
 * eleventh cannot arrive silently (issue #1781).
 */
describe("the seeded board holds no standing crew clash", () => {
  it("rosters nobody onto two overlapping departures", async () => {
    const { db, shop } = await seededShopContext();

    const board = await db
      .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
      .from(trips)
      .where(
        and(eq(trips.shopId, shop.id), ne(trips.status, "cancelled"), isNull(trips.deletedAt)),
      );

    const clashing: string[] = [];
    for (const trip of board) {
      const clashes = await crewClashes(db, shop.id, trip.id, new Date("2026-07-21T13:30:00Z"));
      for (const clash of clashes) {
        clashing.push(`${trip.title} — ${clash.fullName} is also on ${clash.otherTitle}`);
      }
    }

    expect(clashing).toEqual([]);
  });
});

/**
 * **Every seeded crew is one `setTripCrew` would write (issue #1813).** The
 * five seed modules insert `trip_assignments` directly, and Aaron ruled (2026-09-16) that the
 * question of routing them through the product writer be measured before
 * anything was converted. Measured on 2026-10-12: `setTripCrew` accepted all
 * twelve of `seed-trips`' crews unchanged, at no measurable cost to the
 * template build — but it records a pending crew notice for every assignment
 * (26 rows), flushes the urgent ones and publishes a manifest event per trip,
 * which is news about changes that never happened sitting in the fixture. So
 * the inserts stay direct, and this asks the writer's whole question instead,
 * for every module's crews at once: replay each seeded roster through
 * `setTripCrew` unchanged and expect it accepted. It covers every constraint
 * the writer enforces — unknown staff, overlap, an unstaffed course session,
 * an instructor rostered off the water — where the clash walk above covers one.
 */
describe("every seeded crew passes the product's own crew writer", () => {
  it("accepts each seeded roster, unchanged, through setTripCrew", async () => {
    const { db, shop } = await seededShopContext();

    const rows = await db
      .select({
        tripId: tripAssignments.tripId,
        title: trips.title,
        personId: tripAssignments.personId,
        tripRole: tripAssignments.tripRole,
      })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(
        and(eq(trips.shopId, shop.id), ne(trips.status, "cancelled"), isNull(trips.deletedAt)),
      );
    const rosters = new Map<string, { title: string; crew: typeof rows }>();
    for (const row of rows) {
      const roster = rosters.get(row.tripId) ?? { title: row.title, crew: [] };
      roster.crew.push(row);
      rosters.set(row.tripId, roster);
    }
    expect(rosters.size).toBeGreaterThan(0);

    const refused: string[] = [];
    for (const [tripId, { title, crew }] of rosters) {
      const accepted = await setTripCrew(
        db,
        shop.id,
        tripId,
        crew.map(({ personId, tripRole }) => ({ personId, tripRole })),
      );
      if (!accepted) refused.push(title);
    }

    expect(refused).toEqual([]);
  });
});

/**
 * B42 (visual review 2026-10-24): the course page's date row names who leads
 * the Open Water class and where it dives, as plain words. The demo is where
 * that row is seen, so the seeded session carries both: a site on the
 * session, and an instructor of record who agreed to be named to divers.
 */
describe("seeded Open Water session — what its course-page row names", () => {
  it("has a site and a named instructor the public read returns", async () => {
    const { db, shop } = await seededShopContext();
    const [openWater] = await db
      .select({ courseId: trips.courseId })
      .from(trips)
      .where(
        and(eq(trips.shopId, shop.id), eq(trips.title, "Open Water Diver — three-day course")),
      );
    if (!openWater?.courseId) throw new Error("expected the seeded Open Water session");

    const [session] = await listUpcomingSessionsForCourse(db, shop.id, openWater.courseId);
    expect(session?.siteName).toBe("Pickles Reef");

    const crew = await tripPublicCrew(db, shop.id, session.id);
    expect(crew.filter((member) => member.tripRole === "instructor").length).toBeGreaterThan(0);
  });
});
