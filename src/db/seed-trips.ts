import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import {
  type courses,
  type DiveSpecialty,
  type diveSites,
  people,
  personRoles,
  type TripAssignmentRole,
  tripAssignments,
  tripDives,
  tripRequirements,
  tripScheduleDays,
  trips,
} from "./schema";
import { at, demoTodayDepartureStart } from "./seed-clock";

/**
 * The three headline boats plus the rest of the week: each departure with its
 * meeting windows, its dive plan, the readiness requirements it gates on, its
 * crew, and — for the ones close enough that somebody has actually looked — this
 * morning's conditions.
 *
 * One departure always sails *today* (`demoTodayDepartureStart`), because the
 * departure board is the first thing staff see and a demo with no boat out
 * cannot show it. Crew is rostered to make the interesting cases visible: a
 * course session with its instructor, and one where the divemaster is rostered
 * as the instructor.
 */
export async function seedTrips(
  db: DbExecutor,
  shopId: string,
  ctx: {
    instructor: { id: string };
    /** The shop's second instructor — see the crew block below (DOM-M7). */
    reliefInstructor: { id: string };
    courseRows: (typeof courses.$inferSelect)[];
    discoverCourse: typeof courses.$inferSelect;
    openWaterCourse: typeof courses.$inferSelect | undefined;
    siteByName: Map<string, typeof diveSites.$inferSelect>;
    benwood: typeof diveSites.$inferSelect | undefined;
    french: typeof diveSites.$inferSelect | undefined;
    courseIdByTitle: Map<string, string>;
  },
) {
  const {
    instructor,
    reliefInstructor,
    courseRows,
    courseIdByTitle,
    discoverCourse,
    openWaterCourse,
    siteByName,
    benwood,
    french,
  } = ctx;

  /**
   * A course session row, or nothing when the shop does not carry that course.
   * The catalog decides what can be scheduled; a session with no course behind
   * it would be a trip whose admission rule came from nowhere.
   */
  function courseSession(
    courseTitle: string,
    trip: {
      title: string;
      description: string;
      startsAt: Date;
      endsAt: Date;
      capacity: number;
      plannedDives?: number;
    },
  ) {
    const courseId = courseIdByTitle.get(courseTitle);
    return courseId ? [{ shopId, courseId, ...trip }] : [];
  }
  const todaySailStart = demoTodayDepartureStart();
  const tripRows = await db
    .insert(trips)
    .values([
      {
        shopId,
        diveSiteId: siteByName.get("Molasses Reef")?.id,
        title: "Two-Tank Reef — Molasses & French",
        // Time-neutral copy: this trip sails at whatever hour keeps it on
        // today's board, so "morning" would read as a bug after lunch.
        description: "Double dip on the outer reef. All levels, OW required.",
        startsAt: todaySailStart, // sails today, so Today always has a board
        endsAt: new Date(todaySailStart.getTime() + 3.5 * 60 * 60 * 1000),
        capacity: 12,
      },
      {
        shopId,
        title: "Night Dive — City of Washington",
        description: "Torches, tarpon, and bioluminescence. Night specialty required.",
        // A twilight double: depart ~7:30 PM Eastern, dive 1 at dusk (matching
        // its "Wreck site at dusk" plan), dive 2 in full dark, 3.5 h dock to
        // dock — two night dives plus a surface interval don't fit in less.
        startsAt: at(2, 19, 30),
        endsAt: at(2, 23, 0),
        capacity: 8,
      },
      {
        shopId,
        diveSiteId: siteByName.get("Spiegel Grove")?.id,
        title: "Wreck Trip — Spiegel Grove",
        description: "The big one. AOW + Deep + nitrox required.",
        startsAt: at(5, 12, 0),
        endsAt: at(5, 16, 0),
        capacity: 10,
      },
      {
        shopId,
        diveSiteId: siteByName.get("Christ of the Abyss")?.id,
        title: "Two-Tank Reef — Christ of the Abyss",
        description: "Classic shallow sites, great for refreshers and new OW divers.",
        startsAt: at(7, 11, 30),
        endsAt: at(7, 15, 0),
        capacity: 12,
      },
      {
        shopId,
        courseId: discoverCourse.id,
        title: "Discover Scuba — Pool & Reef",
        description: "A small, instructor-led first breath underwater. No C-card required.",
        startsAt: at(4, 14, 0),
        endsAt: at(4, 17, 0),
        capacity: 4,
      },
      // The course page is only half a demo without a date to book: this is the
      // session its "See dates" button lands on.
      ...(openWaterCourse
        ? [
            {
              shopId,
              courseId: openWaterCourse.id,
              title: "Open Water Diver — three-day course",
              description: "Certification course over three days. No experience required.",
              startsAt: at(9, 8, 0),
              endsAt: at(11, 17, 0),
              // 5 students to one instructor: a realistic class, and it keeps
              // this session's "N spots left" distinct from every other seeded
              // trip's, which e2e assertions match on by text.
              capacity: 5,
            },
          ]
        : []),
      // A working board is not four boats: these fill out the fortnight so the
      // schedule, the dive-site pages, and the course catalog all have
      // something behind them. Every one leaves a different number of spots —
      // "N spots left" is the string e2e matches trips by, and two trips
      // showing the same count make that assertion ambiguous.
      {
        shopId,
        diveSiteId: benwood?.id,
        title: "Two-Tank Reef — Benwood & Elbow",
        description: "Shallow wreck first, coral heads second. A good day-two boat.",
        startsAt: at(3, 11, 30),
        endsAt: at(3, 15, 0),
        capacity: 12,
      },
      {
        shopId,
        diveSiteId: french?.id,
        title: "Afternoon Two-Tank — French Reef",
        description: "Swim-throughs and ledges, with the light coming in low on the second tank.",
        startsAt: at(6, 13, 0),
        endsAt: at(6, 17, 0),
        capacity: 10,
      },
      ...courseSession("Nitrox Diver", {
        title: "Nitrox Diver — classroom & two dives",
        description: "Analyze your own cylinder, then use the procedures on two reef dives.",
        startsAt: at(8, 8, 0),
        endsAt: at(8, 16, 0),
        capacity: 6,
      }),
      ...courseSession("Peak Performance Buoyancy", {
        title: "Peak Performance Buoyancy — one day",
        description: "A real weight check, then two dives spent hovering.",
        startsAt: at(13, 8, 0),
        endsAt: at(13, 15, 0),
        capacity: 4,
      }),
      // Two evenings, because that is what the Night Diver page sells: its
      // day-by-day plan is "Evening 1 — dusk and dark" and "Evening 2 —
      // navigation", and its at-a-glance line reads "2 evenings · 3 dives"
      // (src/db/course-templates.ts). This session used to run 17:00 on the
      // 15th to 21:30 on the *17th*, so the catalogue page and the session it
      // links to disagreed about the length of the course by a whole evening.
      // Three dives across two evenings — two on the first, one on the second
      // — is the shape of the course, not one dive per day.
      ...courseSession("Night Diver", {
        title: "Night Diver — two evenings",
        description: "Dusk, dark, and navigation, over two consecutive evenings.",
        startsAt: at(15, 16, 0),
        endsAt: at(16, 21, 0),
        capacity: 6,
        plannedDives: 3,
      }),
      ...courseSession("Deep Diver", {
        title: "Deep Diver — Spiegel Grove & the wall",
        description: "Four dives building to 40 meters (130 feet), with gas planning that keeps up.",
        startsAt: at(20, 8, 0),
        endsAt: at(21, 16, 0),
        capacity: 6,
        plannedDives: 4,
      }),
    ])
    .returning();

  /**
   * When a multi-day departure actually meets.
   *
   * `trips.starts_at`/`ends_at` bound the whole run — first morning to last
   * evening — and say nothing about the nights in between, so every departure
   * that meets more than once needs a `trip_schedule_days` row per day or the
   * page prints one continuous 57-hour outing. Anything absent here meets once,
   * on its own window, which is every ordinary boat.
   *
   * Keyed by the session's own title rather than by course id: the Open Water
   * class was the only entry when this was an `if`, and the two multi-day
   * course sessions added since silently fell through it. Each set of windows
   * matches the day-by-day plan on that course's published page
   * (src/db/course-templates.ts) — a demo whose Night Diver page promises two
   * evenings while the session it links to spans three is a bug a shop reports.
   */
  const meetingDays: Record<string, { startsAt: Date; endsAt: Date }[]> = {
    "Open Water Diver — three-day course": [
      { startsAt: at(9, 8), endsAt: at(9, 14) },
      { startsAt: at(10, 8), endsAt: at(10, 16) },
      { startsAt: at(11, 9), endsAt: at(11, 17) },
    ],
    "Night Diver — two evenings": [
      { startsAt: at(15, 16, 0), endsAt: at(15, 21, 30) },
      { startsAt: at(16, 17, 0), endsAt: at(16, 21, 0) },
    ],
    "Deep Diver — Spiegel Grove & the wall": [
      { startsAt: at(20, 8, 0), endsAt: at(20, 15, 0) },
      { startsAt: at(21, 8, 0), endsAt: at(21, 16, 0) },
    ],
  };
  await db.insert(tripScheduleDays).values(
    tripRows.flatMap((trip) => {
      const days = meetingDays[trip.title];
      if (days) {
        return days.map((day, index) => ({ tripId: trip.id, dayNumber: index + 1, ...day }));
      }
      return [{ tripId: trip.id, dayNumber: 1, startsAt: trip.startsAt, endsAt: trip.endsAt }];
    }),
  );

  /**
   * What each tank actually is. "Dive 1 · Dive 2" tells a diver nothing they
   * could not have guessed; these are the words the crew uses at the briefing,
   * which is what makes a trip page worth opening the night before.
   *
   * A trip with no entry here still gets its dives — just unnamed, the way a
   * charter looks before anyone has written the plan.
   */
  const divePlans: Record<string, Array<{ title: string; site?: string; description: string }>> = {
    "Two-Tank Reef — Molasses & French": [
      {
        title: "Molasses Reef",
        site: "Molasses Reef",
        description: "A relaxed sweep along the outer reef. Look for rays in the sand channels.",
      },
      {
        title: "French Reef",
        site: "French Reef",
        description:
          "French Reef is the second tank; the crew confirms the exact mooring at the dock.",
      },
    ],
    "Two-Tank Reef — Benwood & Elbow": [
      {
        title: "Benwood Wreck",
        site: "Benwood Wreck",
        description: "Bow to stern along the sand, then back over the plates. Watch the ceilings.",
      },
      {
        // Deliberately names no place. This is the seed's one tank with no
        // `site` — the fixture behind "Site to be confirmed" and the "one dive
        // site, two dive briefings" reading that e2e/trips.spec.ts asserts —
        // and a heading that named a reef while the line under it said the site
        // was unchosen contradicted itself. `DiveBriefingCard` renders the
        // dive's title as its heading and the site (or its absence) underneath,
        // so the title has to be about the tank, not about a mooring no
        // `dive_sites` row backs.
        title: "Second tank — the crew's call at the dock",
        description:
          "Shallow coral heads and a wreck-strewn bottom; a long, easy second tank on a full tank of air. Which mooring depends on the wind, so the crew names it on the way out.",
      },
    ],
    "Afternoon Two-Tank — French Reef": [
      {
        title: "French Reef swim-throughs",
        site: "French Reef",
        description: "Christmas Tree Cave and the ledges, into the current and drifting back.",
      },
      {
        title: "White Sand Bottom Cave",
        site: "French Reef",
        description: "The low sun gets into the overhangs — the best light of the day is here.",
      },
    ],
    "Wreck Trip — Spiegel Grove": [
      {
        title: "Flight deck and cranes",
        site: "Spiegel Grove",
        description:
          "Down the mooring together, a tour of the exterior, and back to the line with reserve gas.",
      },
      {
        title: "Well deck",
        site: "Spiegel Grove",
        description: "Shallower and slower after the surface interval, staying outside the hull.",
      },
    ],
    "Two-Tank Reef — Christ of the Abyss": [
      {
        title: "Christ of the Abyss",
        site: "Christ of the Abyss",
        description: "The statue first, before the other boats arrive, then the sand channels.",
      },
      {
        title: "Dry Rocks coral garden",
        site: "Christ of the Abyss",
        description: "A shallow, unhurried loop — the tank most refresher divers remember.",
      },
    ],
    "Night Dive — City of Washington": [
      {
        title: "Wreck site at dusk",
        description: "In the water before the light goes, so the descent is on a familiar bottom.",
      },
      {
        title: "Full dark",
        description: "Torches off for a minute at the safety stop, for the bioluminescence.",
      },
    ],
  };

  const tripDiveRows = tripRows.flatMap((trip) => {
    const plan = divePlans[trip.title] ?? [];
    return Array.from({ length: trip.plannedDives }, (_, index) => {
      const dive = plan[index];
      return {
        tripId: trip.id,
        diveNumber: index + 1,
        title: dive?.title ?? null,
        diveSiteId: dive?.site
          ? (siteByName.get(dive.site)?.id ?? null)
          : index === 0
            ? (trip.diveSiteId ?? null)
            : null,
        description: dive?.description ?? null,
      };
    });
  });
  if (tripDiveRows.length > 0) await db.insert(tripDives).values(tripDiveRows);

  await db.insert(tripRequirements).values(
    tripRows.map((trip) => {
      // The night dive has no site of its own, so its Night gate is trip-level;
      // night diving needs the Night specialty, not a higher level. The wreck
      // trip inherits AOW + Deep from the Spiegel Grove site and adds a
      // trip-level nitrox requirement (deep wreck bottom time).
      const isNight = trip.title.startsWith("Night Dive");
      const isWreck = trip.title.startsWith("Wreck Trip");
      // Same rule createTrip applies: a course session inherits its catalog
      // baseline verbatim, null included — an entry-level class is the one
      // place an uncertified diver belongs on a boat. Everything else takes the
      // shop's default Open Water gate.
      const course = trip.courseId
        ? courseRows.find((entry) => entry.id === trip.courseId)
        : undefined;
      return {
        tripId: trip.id,
        shopId,
        requiresWaiver: true,
        minimumCertificationLevel: course
          ? course.minimumCertificationLevel
          : ("open_water" as const),
        requiredSpecialties: (isNight ? ["night"] : []) as DiveSpecialty[],
        requiresNitrox: isWreck,
        // The premium wreck charter is paid up front; the reef trips are not.
        requiresPayment: isWreck,
      };
    }),
  );

  const discoverSession = tripRows.find((trip) => trip.courseId === discoverCourse.id);
  if (!discoverSession) throw new Error("seed: DSD session missing");
  // Every course session needs an instructor before it can take a booking. The
  // charters get a captain and a divemaster, because a boat with an empty crew
  // list is the one thing no dive shop has ever had.
  // Last-wins over an unordered select, so this is only safe for a role exactly
  // one person holds. `instructor` is no longer one of those (DOM-M7) — which is
  // why both instructors are resolved by name in `seedDemoSchedule` and passed
  // in, and why nothing below reads `crewByRole.get("instructor")`.
  const crewByRole = new Map(
    (
      await db
        .select({ id: people.id, role: personRoles.role })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(eq(people.shopId, shopId))
    ).map((row) => [row.role, row.id]),
  );
  const captainId = crewByRole.get("captain");
  const divemasterId = crewByRole.get("divemaster");
  /**
   * The job each person is doing on this sailing, not just who is aboard
   * (DOM-M3, ADR 20260803-per-trip-crew-role). Deliberately *varied*: a seed
   * where every `trip_role` simply repeats that person's own shop-wide role
   * demonstrates nothing about what the column changed, and — worse — leaves
   * the `null` path, which is the state 100% of production rows are in,
   * unexercised by any seeded row.
   *
   * So the demo shop carries, on purpose:
   *
   * - a charter where the **divemaster is driving** (`captain`) and the captain
   *   is on the lines (`crew`): the DOM-M3 case itself. Keiko is still a
   *   divemaster and still aboard; she is not supervising anybody in the water,
   *   so she is not an in-water certified assistant on that sailing.
   * - a charter with **no roles at all**: exactly what every row written before
   *   the column existed looks like, counted by shop-wide inference, unchanged.
   * - a course session with a **captain** aboard. Before this the seeded course
   *   session had exactly one person on it — a boat with nobody driving it.
   * - a course session where the **divemaster is rostered as its instructor**:
   *   the roster is a scheduling document and cannot mint a credential, so she
   *   still counts as a certified assistant and the session's real instructor
   *   is still the one carrying it.
   * - a course session where an **instructor is rostered as its divemaster**
   *   (DOM-M7, review 20260802): the last (shop role × trip role) combination
   *   with no visible example, and the one direction that is a genuine, common
   *   *downgrade* rather than a roster over-claim — the shop's second
   *   instructor assisting somebody else's class. `inWaterCrewRole` counts her
   *   as a certified assistant, not an instructor, which is what
   *   `crew-roles.test.ts` asserts abstractly and nothing showed concretely.
   *   This needs two instructors on the shop; before Talia there was one, and
   *   rostering him as an assistant would have left the class unstaffed.
   *
   * None of this moves a seeded ratio downward: a captain and a deckhand were
   * already worth nothing to it, the divemaster-as-instructor still counts as
   * the assistant she is qualified to be, and the instructor-as-divemaster adds
   * an assistant to a session that already has its instructor.
   */
  type CrewRow = { tripId: string; personId: string; tripRole: TripAssignmentRole | null };
  // The one session the relief instructor assists on. A specialty course rather
  // than an entry-level one on purpose: a second instructor spending the day as
  // somebody else's assistant is what a small shop's specialty day looks like,
  // and it keeps the Discover Scuba and Open Water sessions — the two a demo
  // visitor is most likely to open — showing exactly what they showed before.
  const reliefAssistedCourseId = courseIdByTitle.get("Nitrox Diver");
  let charterIndex = 0;
  await db.insert(tripAssignments).values(
    tripRows.flatMap((trip): CrewRow[] => {
      if (trip.courseId) {
        return [
          {
            tripId: trip.id,
            personId: instructor.id,
            tripRole: "instructor" as TripAssignmentRole,
          },
          ...(captainId && trip.courseId === discoverCourse.id
            ? [{ tripId: trip.id, personId: captainId, tripRole: "captain" as TripAssignmentRole }]
            : []),
          ...(divemasterId && openWaterCourse && trip.courseId === openWaterCourse.id
            ? [
                {
                  tripId: trip.id,
                  personId: divemasterId,
                  tripRole: "instructor" as TripAssignmentRole,
                },
              ]
            : []),
          ...(reliefAssistedCourseId && trip.courseId === reliefAssistedCourseId
            ? [
                {
                  tripId: trip.id,
                  personId: reliefInstructor.id,
                  tripRole: "divemaster" as TripAssignmentRole,
                },
              ]
            : []),
        ];
      }
      const nth = charterIndex++;
      // nth 0: the divemaster is driving. nth 1: nobody has said. Everyone
      // else: the ordinary roster, each doing the job they hold.
      const captainRole: TripAssignmentRole | null =
        nth === 0 ? "crew" : nth === 1 ? null : "captain";
      const divemasterRole: TripAssignmentRole | null =
        nth === 0 ? "captain" : nth === 1 ? null : "divemaster";
      return [
        ...(captainId
          ? [{ tripId: trip.id, personId: captainId, tripRole: captainRole } satisfies CrewRow]
          : []),
        ...(divemasterId
          ? [
              {
                tripId: trip.id,
                personId: divemasterId,
                tripRole: divemasterRole,
              } satisfies CrewRow,
            ]
          : []),
      ];
    }),
  );

  // Conditions are a live reading, not a description: the boat that sails today
  // has this morning's numbers, the next two have yesterday's, and everything
  // further out is honestly blank because nobody has looked yet.
  const conditions: Array<[number, Record<string, unknown>]> = [
    [
      0,
      {
        conditionsSummary:
          "A calm morning is expected; the crew will confirm the final call at the dock.",
        waterTemperatureC: 27,
        visibilityMeters: 18,
        surfaceConditions: "Light east breeze · gentle chop",
      },
    ],
    [
      1,
      {
        conditionsSummary:
          "Warm and still after dark. Bring a light layer for the surface interval.",
        waterTemperatureC: 28,
        visibilityMeters: 15,
        surfaceConditions: "Glassy · no swell forecast",
      },
    ],
    [
      2,
      {
        conditionsSummary:
          "Open water, so the call is made at the dock. Expect current on the line.",
        waterTemperatureC: 26,
        visibilityMeters: 24,
        surfaceConditions: "Moderate southeast wind · 1 m swell",
      },
    ],
  ];
  for (const [index, values] of conditions) {
    const trip = tripRows[index];
    if (!trip) continue;
    await db
      .update(trips)
      .set({ ...values, conditionsUpdatedAt: nowDate() })
      .where(eq(trips.id, trip.id));
  }

  return { tripRows, captainId, divemasterId };
}
