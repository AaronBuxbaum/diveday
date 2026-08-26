import { rollCallCheckpoints } from "@/lib/roll-call";
import type { DbExecutor } from "./client";
import {
  bookingPayments,
  bookings,
  type DiveSpecialty,
  notificationDeliveries,
  notificationDeliveryAttempts,
  rollCallEvents,
  type TripAssignmentRole,
  tripAssignments,
  tripDives,
  tripLastMinutePromos,
  tripRequirements,
  tripScheduleDays,
  trips,
  tripWaitlistEntries,
  waiverRecords,
} from "./schema";
import { at, nextCreatedAt } from "./seed-clock";

/** The returned demo departure that gives Close-Out a finished local-day dive. */
export const DEMO_COMPLETED_TRIP_TITLE = "Dawn Two-Tank — Molasses Reef";

/**
 * A fuller month: charters and course sessions beyond the four headline
 * boats seeded above, so the schedule reads like a shop that runs most days
 * of the week — not four trips in a fortnight. Every catalog course gets at
 * least one dated session somewhere in here (several get two), the two new
 * dive sites (Duane, Pickles Reef) earn their keep, and a couple of trips
 * are cancelled outright — the weather does that to a real boat schedule.
 *
 * Drawn entirely from the extended roster (customers[10] and up) so nothing
 * here touches today's three exactly-asserted boats, and Hana (customers[12],
 * who must stay booked on *nothing*, see the comment at her cert rows above)
 * never appears. Most bookings get a signed waiver — the same "most people
 * fill it out" norm as today's reef trip — with a steady ~1-in-7 left
 * unsigned so a diver profile or a trip's Guests tab still shows the
 * occasional straggler.
 */
export async function seedMoreTrips(
  db: DbExecutor,
  shopId: string,
  ctx: {
    customers: { id: string }[];
    siteByName: Map<string, { id: string; name: string }>;
    courseRows: Array<{
      id: string;
      title: string;
      minimumCertificationLevel:
        | "open_water"
        | "advanced_open_water"
        | "rescue"
        | "divemaster"
        | "instructor"
        | null;
    }>;
    instructorId: string;
    captainId: string | undefined;
    divemasterId: string | undefined;
    waiverTemplate: {
      id: string;
      title: string;
      version: number;
      materialGeneration: number;
      body: string;
    };
  },
): Promise<void> {
  const { customers, siteByName, courseRows, instructorId, captainId, divemasterId } = ctx;
  const courseByTitle = new Map(courseRows.map((course) => [course.title, course]));

  // Everyone from the extended roster except: Hana (12, must stay unbooked),
  // and the five deliberately-uncertified walk-ups (27, 38, 58, 68, 78), who
  // only ever appear on an entry-level session below.
  const excludedFromPool = new Set([12, 27, 38, 58, 68, 78]);
  const generalPool = customers
    .map((_, index) => index)
    .filter((index) => index >= 10 && index < customers.length && !excludedFromPool.has(index));
  let poolCursor = 0;
  const draw = (n: number): number[] => {
    const picked: number[] = [];
    for (let i = 0; i < n; i++) {
      const index = generalPool[poolCursor % generalPool.length];
      if (index !== undefined) picked.push(index);
      poolCursor++;
    }
    return picked;
  };

  type ExtraTripDef = {
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    siteName?: string;
    /**
     * Where the *second* tank goes, when the title names two moorings. Without
     * it a two-site day would put both dives on the first site and the schedule
     * card would name one place for a trip whose own title names two.
     */
    secondSiteName?: string;
    courseTitle?: string;
    isNight?: boolean;
    isWreck?: boolean;
    status?: "scheduled" | "cancelled";
    conditionsHold?: boolean;
    conditionsSummary?: string;
    completedDemo?: boolean;
    roster: number[];
    priceCents?: number;
  };

  // Each capacity/booked pair is chosen so its remaining-seat count never
  // reads "3 spots left" (the reef trip's exact, asserted text), "Full" (the
  // wreck charter's alone), or "6 spots left" (reserved for a spec's own
  // throwaway trip) — see the comment above `laterRosters`.
  const tripDefs: ExtraTripDef[] = [
    {
      title: DEMO_COMPLETED_TRIP_TITLE,
      description: "A first-light boat, back at the dock before the regular morning run.",
      // This is deliberately on the shop's local day, not yesterday in UTC: the
      // close-out should show a real completed departure while the demo clock is
      // at its stable 09:30 local baseline.
      startsAt: at(0, 5, 30),
      endsAt: at(0, 8, 30),
      capacity: 12,
      siteName: "Molasses Reef",
      completedDemo: true,
      roster: draw(8),
    },
    {
      title: "Morning Two-Tank — Molasses Reef",
      description: "An early boat on the outer reef, back at the dock before the wind picks up.",
      startsAt: at(1, 7, 0),
      endsAt: at(1, 10, 30),
      capacity: 12,
      siteName: "Molasses Reef",
      roster: draw(8),
    },
    {
      title: "Two-Tank Reef — French Reef",
      description: "Ledges and swim-throughs — a second boat the same week as the regulars.",
      startsAt: at(2, 11, 0),
      endsAt: at(2, 14, 30),
      capacity: 10,
      siteName: "French Reef",
      roster: draw(8),
    },
    {
      title: "Scuba Refresher — half day",
      description: "A patient skills tune-up before getting back in the water.",
      startsAt: at(4, 9, 0),
      endsAt: at(4, 12, 0),
      capacity: 4,
      courseTitle: "Scuba Refresher",
      // Both lapsed-card divers from the roster above — exactly who a
      // refresher course is for.
      roster: [31, 66],
    },
    {
      title: "Two-Tank Reef — Benwood & Molasses",
      description: "Shallow wreck first, coral heads second — a quiet midweek boat.",
      startsAt: at(6, 8, 0),
      endsAt: at(6, 11, 30),
      capacity: 12,
      siteName: "Benwood Wreck",
      secondSiteName: "Molasses Reef",
      roster: draw(5),
    },
    {
      title: "Sunset Two-Tank — French Reef",
      description: "Ledges and swim-throughs with the light coming in low on the second tank.",
      startsAt: at(8, 16, 0),
      endsAt: at(8, 19, 30),
      capacity: 10,
      siteName: "French Reef",
      roster: draw(9),
    },
    {
      title: "Rescue Diver — three-day course",
      description: "Problem prevention and rescue skills for experienced divers.",
      // Kept clear of the seeded Open Water course (day 9-11) and Deep Diver
      // (day 20-21) — both also crew Marcus, and overlapping his assignment
      // window would collide (see the "no seeded course may overlap" rule
      // near seedMoreTrips's top).
      startsAt: at(58, 8, 0),
      endsAt: at(60, 17, 0),
      capacity: 4,
      courseTitle: "Rescue Diver",
      roster: [29, 40, 42],
    },
    {
      title: "Sunset Two-Tank — Christ of the Abyss (weather hold)",
      description: "Cancelled ahead of a small-craft advisory; rescheduling with everyone booked.",
      startsAt: at(10, 16, 0),
      endsAt: at(10, 19, 30),
      capacity: 10,
      siteName: "Christ of the Abyss",
      status: "cancelled",
      conditionsHold: true,
      conditionsSummary: "Small-craft advisory through the afternoon — the crew called it early.",
      roster: [],
    },
    {
      title: "Discover Scuba Diving — afternoon",
      description:
        "A small, instructor-led first breath underwater. No prior certification required.",
      startsAt: at(12, 13, 0),
      endsAt: at(12, 16, 0),
      capacity: 4,
      courseTitle: "Discover Scuba Diving",
      roster: [27, ...draw(1)],
    },
    {
      title: "Wreck Trip — USCGC Duane",
      description: "A second deep advanced wreck. AOW + Deep + nitrox required.",
      startsAt: at(14, 12, 0),
      endsAt: at(14, 16, 0),
      capacity: 10,
      siteName: "USCGC Duane",
      isWreck: true,
      roster: [18, 19, 20, 21, 22, 23],
    },
    {
      title: "Two-Tank Reef — French Reef (small craft advisory)",
      description: "Cancelled for weather; nobody had booked yet.",
      startsAt: at(17, 11, 0),
      endsAt: at(17, 14, 30),
      capacity: 10,
      siteName: "French Reef",
      status: "cancelled",
      conditionsHold: true,
      conditionsSummary: "Small-craft advisory — rescheduled for later in the month.",
      roster: [],
    },
    {
      title: "Two-Tank Reef — Pickles Reef",
      description:
        "The barrel-coral classic — beginner-friendly and one of the busiest boats this week.",
      startsAt: at(16, 11, 30),
      endsAt: at(16, 15, 0),
      capacity: 12,
      siteName: "Pickles Reef",
      roster: draw(11),
    },
    {
      title: "Family Two-Tank — Christ of the Abyss",
      description: "A gentle, shallow boat — a good first charter for a family diving together.",
      startsAt: at(19, 10, 0),
      endsAt: at(19, 13, 30),
      capacity: 8,
      siteName: "Christ of the Abyss",
      roster: draw(6),
    },
    {
      title: "Try Scuba — SSI first dive",
      description: "A supervised first scuba experience.",
      // Day 20 is the seeded Deep Diver session's own window (day 20-21) —
      // kept clear so both keep their own claim on Marcus's crew slot.
      startsAt: at(61, 13, 0),
      endsAt: at(61, 16, 0),
      capacity: 4,
      courseTitle: "Try Scuba",
      roster: draw(2),
    },
    {
      title: "Midweek Two-Tank — Molasses Reef",
      description: "A quiet boat on the outer reef — plenty of room this week.",
      startsAt: at(23, 12, 0),
      endsAt: at(23, 15, 30),
      capacity: 12,
      siteName: "Molasses Reef",
      roster: draw(4),
    },
    {
      title: "Three-Day SSI Certification — Open Water",
      description: "SSI's entry-level autonomous diver certification.",
      // Days 22 and 24 are reserved by e2e specs that create their own
      // Marcus-crewed session there (courses.spec.ts, gear-fit-and-age.spec.ts)
      // — kept clear so setTripCrew's overlap check never collides with them.
      startsAt: at(63, 9, 0),
      endsAt: at(65, 17, 0),
      capacity: 4,
      courseTitle: "SSI Open Water Diver",
      // The three previously-uncertified walk-ups — finally taking the class.
      roster: [58, 68, 78],
    },
    {
      title: "Night Dive — French Reef",
      description: "Torches, tarpon, and bioluminescence. Night specialty required.",
      startsAt: at(25, 19, 0),
      endsAt: at(25, 22, 30),
      capacity: 8,
      isNight: true,
      roster: [24, 25, 29],
    },
    {
      title: "Two-Tank Reef — Benwood Wreck",
      description: "Bow to stern along the sand, then back over the plates.",
      startsAt: at(26, 9, 0),
      endsAt: at(26, 12, 30),
      capacity: 10,
      siteName: "Benwood Wreck",
      roster: draw(8),
    },
    {
      title: "Advanced Adventurer — two-day course",
      description: "Five guided specialty adventure dives.",
      startsAt: at(26, 13, 0),
      endsAt: at(27, 17, 0),
      capacity: 5,
      courseTitle: "Advanced Adventurer",
      roster: [52, 55, 61],
    },
    {
      title: "Two-Site Combo — Statue & Molasses Reef",
      description: "Classic shallow sites, then the outer reef on the second tank.",
      startsAt: at(28, 11, 0),
      endsAt: at(28, 14, 30),
      capacity: 12,
      siteName: "Christ of the Abyss",
      secondSiteName: "Molasses Reef",
      roster: draw(7),
    },
    {
      title: "Two-Tank Reef — French Reef & Molasses",
      description: "Ledges first, the outer reef second — a two-site charter, dock to dock.",
      startsAt: at(30, 8, 0),
      endsAt: at(30, 11, 30),
      capacity: 12,
      siteName: "French Reef",
      secondSiteName: "Molasses Reef",
      roster: draw(8),
    },
    {
      title: "Advanced Wreck — USCGC Duane",
      description: "A second sailing to the Duane. AOW + Deep + nitrox required.",
      startsAt: at(33, 12, 0),
      endsAt: at(33, 16, 0),
      capacity: 10,
      siteName: "USCGC Duane",
      isWreck: true,
      roster: draw(6),
    },
    {
      title: "Peak Performance Buoyancy — weekend",
      description: "A real weight check, then two dives spent hovering.",
      startsAt: at(35, 9, 0),
      endsAt: at(35, 17, 0),
      capacity: 4,
      courseTitle: "Peak Performance Buoyancy",
      roster: draw(2),
    },
    {
      title: "Two-Tank Reef — Pickles & French",
      description: "A second sailing to the barrel-coral reef, paired with French Reef.",
      startsAt: at(36, 11, 30),
      endsAt: at(36, 15, 0),
      capacity: 12,
      siteName: "Pickles Reef",
      secondSiteName: "French Reef",
      roster: draw(10),
    },
    {
      title: "Diver Stress & Rescue — SSI two-day",
      description: "Recognize stress and respond to diver emergencies.",
      startsAt: at(39, 9, 0),
      endsAt: at(40, 17, 0),
      capacity: 4,
      courseTitle: "Diver Stress & Rescue",
      roster: [64, 70],
    },
    {
      title: "Wreck Diver — PADI four dives",
      description: "Survey, mapping, and limited penetration on four dives.",
      startsAt: at(41, 9, 0),
      endsAt: at(42, 17, 0),
      capacity: 4,
      courseTitle: "Wreck Diver",
      roster: [74, 80],
    },
    {
      title: "Nitrox 40 — SSI one day",
      description: "Use nitrox mixes up to 40 percent oxygen.",
      startsAt: at(44, 9, 0),
      endsAt: at(44, 17, 0),
      capacity: 5,
      courseTitle: "Nitrox 40",
      roster: draw(3),
    },
    {
      title: "Afternoon Two-Tank — Christ of the Abyss",
      description: "A late boat on the shallow statue site — good light for photos.",
      startsAt: at(46, 15, 0),
      endsAt: at(46, 18, 30),
      capacity: 10,
      siteName: "Christ of the Abyss",
      roster: draw(8),
    },
    {
      title: "Two-Tank Reef — Benwood & French",
      description: "The shallow wreck, then ledges and swim-throughs on the second tank.",
      startsAt: at(48, 8, 0),
      endsAt: at(48, 11, 30),
      capacity: 12,
      siteName: "Benwood Wreck",
      secondSiteName: "French Reef",
      roster: draw(10),
    },
    {
      title: "Night Dive — Benwood Wreck",
      description: "A shallower night charter — good for a diver's first dive after dark.",
      startsAt: at(50, 18, 30),
      endsAt: at(50, 22, 0),
      capacity: 8,
      isNight: true,
      roster: draw(4),
    },
    {
      title: "Sunrise Two-Tank — Molasses Reef",
      description: "First boat out, calm water, and the reef to yourselves for an hour.",
      startsAt: at(52, 7, 0),
      endsAt: at(52, 10, 30),
      capacity: 12,
      siteName: "Molasses Reef",
      roster: draw(10),
    },
    {
      title: "Divemaster — PADI internship kickoff",
      description: "The first professional rating, taught as an internship.",
      startsAt: at(54, 9, 0),
      endsAt: at(54, 13, 0),
      capacity: 2,
      courseTitle: "Divemaster",
      // Already Rescue-certified — the internship's actual entry gate.
      roster: [63],
    },
    {
      title: "Family Two-Tank — Molasses Reef",
      description: "A relaxed outer-reef boat, good for a family diving together.",
      startsAt: at(56, 10, 0),
      endsAt: at(56, 13, 30),
      capacity: 8,
      siteName: "Molasses Reef",
      roster: draw(6),
    },
  ];

  const insertedTrips = await db
    .insert(trips)
    .values(
      tripDefs.map((def) => ({
        shopId,
        diveSiteId: def.siteName ? siteByName.get(def.siteName)?.id : undefined,
        courseId: def.courseTitle ? courseByTitle.get(def.courseTitle)?.id : undefined,
        title: def.title,
        description: def.description,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        capacity: def.capacity,
        status: def.status ?? "scheduled",
        conditionsHold: def.conditionsHold ?? false,
        conditionsSummary: def.conditionsSummary,
        priceCents: def.priceCents,
      })),
    )
    .returning();

  await db.insert(tripScheduleDays).values(
    insertedTrips.flatMap((trip, index) => {
      const def = tripDefs[index];
      const dayCount = def?.courseTitle
        ? Math.round((trip.endsAt.getTime() - trip.startsAt.getTime()) / (24 * 60 * 60 * 1000)) + 1
        : 1;
      return Array.from({ length: dayCount }, (_, dayIndex) => ({
        tripId: trip.id,
        dayNumber: dayIndex + 1,
        startsAt:
          dayIndex === 0
            ? trip.startsAt
            : new Date(trip.startsAt.getTime() + dayIndex * 24 * 60 * 60 * 1000),
        endsAt:
          dayIndex === dayCount - 1
            ? trip.endsAt
            : new Date(
                trip.startsAt.getTime() + dayIndex * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
              ),
      }));
    }),
  );

  // One `trip_dives` row per planned dive, the way `seed-trips.ts` and
  // `seed-cert-gates.ts` already mint theirs.
  //
  // These thirty departures used to have none at all while every one of them
  // claimed `planned_dives = 2` (the column's default) — a shop whose schedule
  // says "two-tank" over a trip with zero dives on file. Nothing looked broken,
  // because "where does this trip go" falls back to the trip's own
  // `dive_site_id`, but the fallback is exactly what `summarizeTripDiveSites`
  // exists to replace: a two-site day named one site, and the count of tanks
  // still to be decided was unanswerable.
  //
  // Dive one carries the trip's site; dive two carries the second site when the
  // title names two moorings, and otherwise the same one — a two-tank day at a
  // single reef genuinely dives it twice, and `summarizeTripDiveSites`
  // de-duplicates, so the card still reads "Dive site · Molasses Reef". Course
  // sessions and the night charters carry no site at all, so their dives carry
  // none either: the honest state, and the one the "Site to be confirmed" line
  // was written for.
  await db.insert(tripDives).values(
    insertedTrips.flatMap((trip, index) => {
      const def = tripDefs[index];
      const secondSiteId = def?.secondSiteName
        ? (siteByName.get(def.secondSiteName)?.id ?? null)
        : (trip.diveSiteId ?? null);
      return Array.from({ length: trip.plannedDives }, (_, dive) => ({
        tripId: trip.id,
        diveNumber: dive + 1,
        diveSiteId: dive === 0 ? (trip.diveSiteId ?? null) : secondSiteId,
      }));
    }),
  );

  await db.insert(tripRequirements).values(
    insertedTrips.map((trip, i) => {
      const def = tripDefs[i];
      return {
        tripId: trip.id,
        shopId,
        requiresWaiver: true,
        // Course sessions gate on their own catalog minimum (Discover Scuba,
        // SSI Open Water, and Try Scuba all admit an uncertified diver — the
        // same rule createTrip applies); every other trip takes the shop's
        // default Open Water gate. The Duane wreck's AOW + Deep comes from
        // the site row itself and merges in at read time (readiness.ts).
        minimumCertificationLevel: def.courseTitle
          ? (courseByTitle.get(def.courseTitle)?.minimumCertificationLevel ?? null)
          : ("open_water" as const),
        requiredSpecialties: (def.isNight ? ["night"] : []) as DiveSpecialty[],
        requiresNitrox: def.isWreck ?? false,
        requiresPayment: def.isWreck ?? false,
      };
    }),
  );

  // Same deliberate variety as the demo shop above (see the long note there):
  // the first charter's crew carry **no** per-trip role, which is the state
  // every row written before the column existed is in, and the one no seeded
  // row exercised at all.
  type ScenarioCrewRow = { tripId: string; personId: string; tripRole: TripAssignmentRole | null };
  let scenarioCharterIndex = 0;
  await db.insert(tripAssignments).values(
    insertedTrips.flatMap((trip, i): ScenarioCrewRow[] => {
      const def = tripDefs[i];
      if (def.courseTitle) {
        return [
          { tripId: trip.id, personId: instructorId, tripRole: "instructor" as TripAssignmentRole },
          ...(captainId
            ? [{ tripId: trip.id, personId: captainId, tripRole: "captain" as TripAssignmentRole }]
            : []),
        ];
      }
      const unspecified = scenarioCharterIndex++ === 0;
      return [
        ...(captainId
          ? [
              {
                tripId: trip.id,
                personId: captainId,
                tripRole: unspecified ? null : ("captain" as TripAssignmentRole),
              },
            ]
          : []),
        ...(divemasterId
          ? [
              {
                tripId: trip.id,
                personId: divemasterId,
                tripRole: unspecified ? null : ("divemaster" as TripAssignmentRole),
              },
            ]
          : []),
      ];
    }),
  );

  const insertedBookings = await db
    .insert(bookings)
    .values(
      insertedTrips.flatMap((trip, i) =>
        tripDefs[i].roster
          .map((index) => customers[index])
          .filter((person): person is { id: string } => person !== undefined)
          .map((person) => ({
            shopId,
            tripId: trip.id,
            personId: person.id,
            status: tripDefs[i].completedDemo ? ("checked_in" as const) : ("booked" as const),
            createdAt: nextCreatedAt(),
          })),
      ),
    )
    .returning();

  const completedTrip = insertedTrips.find((trip) => trip.title === DEMO_COMPLETED_TRIP_TITLE);
  const completedBookingIds = new Set(
    insertedBookings
      .filter((booking) => booking.tripId === completedTrip?.id)
      .map((booking) => booking.id),
  );
  if (completedTrip) {
    const completedBookings = insertedBookings.filter(
      (booking) => booking.tripId === completedTrip.id,
    );
    const rollCallRecorderId = captainId ?? instructorId;
    const completedRollCallRows = completedBookings.flatMap((booking) =>
      rollCallCheckpoints(completedTrip.plannedDives).map((checkpoint, index) => ({
        shopId,
        tripId: completedTrip.id,
        bookingId: booking.id,
        recordedByPersonId: rollCallRecorderId,
        status: "boarded" as const,
        checkpoint,
        source: "live" as const,
        occurredAt: new Date(completedTrip.startsAt.getTime() + index * 90 * 60 * 1000),
      })),
    );
    if (completedRollCallRows.length > 0)
      await db.insert(rollCallEvents).values(completedRollCallRows);

    // A partially completed report run is more useful demo state than an empty
    // queue: six reports have gone out and two remain for the staffer to notice.
    // The existing delivery tables are the source of truth for this task; no
    // close-out-specific status row is invented here.
    const sentReportBookings = completedBookings.slice(
      0,
      Math.max(0, completedBookings.length - 2),
    );
    const recapDeliveries = sentReportBookings.map((booking, index) => ({
      shopId,
      bookingId: booking.id,
      kind: "trip_recap" as const,
      status: "sent" as const,
      providerMessageId: `demo-recap-${shopId}-${index}`,
      attemptedAt: new Date(at(0, 9, 15).getTime() + index * 1000),
    }));
    if (recapDeliveries.length > 0) {
      await db.insert(notificationDeliveries).values(recapDeliveries);
      await db
        .insert(notificationDeliveryAttempts)
        .values(recapDeliveries.map((delivery) => ({ ...delivery, isRetry: false })));
    }
  }

  // Most divers fill out their waiver before the boat leaves — roughly 6 in
  // 7 here, the same "most people sign" norm as today's reef trip — leaving
  // a steady trickle of stragglers so a Guests tab or a diver's profile still
  // shows the occasional unsigned card.
  let extraWaiverToken = 0;
  const extraWaiverRows = insertedBookings.map((booking) => {
    extraWaiverToken++;
    const createdAt = nextCreatedAt();
    // A boarded/completed demo booking must never carry the contradictory
    // state "everyone came home, but the waiver is still unsigned". Keep the
    // unsigned examples on future trips where they are useful roster work.
    const signed = completedBookingIds.has(booking.id) || extraWaiverToken % 7 !== 0;
    return {
      shopId,
      bookingId: booking.id,
      personId: booking.personId,
      templateId: ctx.waiverTemplate.id,
      templateTitle: ctx.waiverTemplate.title,
      templateVersion: ctx.waiverTemplate.version,
      templateGeneration: ctx.waiverTemplate.materialGeneration,
      templateBody: ctx.waiverTemplate.body,
      tokenHash: `seed-extra-waiver-${shopId}-${extraWaiverToken}`,
      // Comfortably past the furthest trip seeded here (day 56).
      expiresAt: at(75, 12),
      createdAt,
      ...(signed
        ? {
            status: "completed" as const,
            signedName: "Signed on file",
            signatureMethod: "in_person" as const,
            consentedAt: createdAt,
            signedAt: createdAt,
            completedAt: createdAt,
          }
        : {}),
    };
  });
  if (extraWaiverRows.length > 0) await db.insert(waiverRecords).values(extraWaiverRows);

  // The Duane wreck readiness track: three of the six divers paid or on
  // deposit — the other three (blocked by cert/specialty/nitrox regardless,
  // see the extended-roster certs above) still owe nothing on file.
  const duaneTrip = insertedTrips.find((trip) => trip.title === "Wreck Trip — USCGC Duane");
  if (duaneTrip) {
    const duaneBookings = insertedBookings.filter((b) => b.tripId === duaneTrip.id);
    const findDuaneBooking = (index: number) =>
      duaneBookings.find((b) => b.personId === customers[index]?.id);
    const duanePaymentPlan: Array<{
      booking: { id: string } | undefined;
      status: "paid" | "deposit_paid";
      amountCents: number;
    }> = [
      { booking: findDuaneBooking(18), status: "paid", amountCents: 18_000 },
      { booking: findDuaneBooking(19), status: "deposit_paid", amountCents: 6_000 },
      { booking: findDuaneBooking(20), status: "paid", amountCents: 18_000 },
    ];
    const duanePaymentSeed = duanePaymentPlan
      .filter((row) => row.booking !== undefined)
      .map((row) => ({
        shopId,
        bookingId: (row.booking as { id: string }).id,
        status: row.status,
        amountCents: row.amountCents,
        currency: "usd",
      }));
    if (duanePaymentSeed.length > 0) await db.insert(bookingPayments).values(duanePaymentSeed);
  }

  // A little front-desk texture on the trips this back-fill added: a
  // wait-list entry on the nearly-full Pickles Reef charter, and a
  // last-minute promo on the quietest midweek boat.
  const picklesTrip = insertedTrips.find((trip) => trip.title === "Two-Tank Reef — Pickles Reef");
  const quietTrip = insertedTrips.find((trip) => trip.title === "Midweek Two-Tank — Molasses Reef");
  const waitlistCandidate = customers[draw(1)[0] ?? -1];
  if (picklesTrip && waitlistCandidate) {
    await db.insert(tripWaitlistEntries).values({
      shopId,
      tripId: picklesTrip.id,
      personId: waitlistCandidate.id,
      createdAt: nextCreatedAt(),
    });
  }
  if (quietTrip) {
    await db
      .insert(tripLastMinutePromos)
      .values({
        shopId,
        tripId: quietTrip.id,
        status: "sent",
        discountPercent: 20,
        code: "DEMO-MIDWEEK-20",
        stripeCouponId: "coupon_demo_midweek",
        stripePromotionCodeId: "promo_demo_midweek",
        expiresAt: at(22, 18),
        recipientCount: 6,
        createdByPersonId: null,
        createdAt: nextCreatedAt(),
      })
      .onConflictDoNothing();
  }
}
