import type { DbExecutor } from "./client";
import {
  bookings,
  certifications,
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
  waiverRecords,
} from "./schema";
import { at, nextCreatedAt } from "./seed-clock";
import { reviewedBy } from "./seed-review";

/**
 * **The four boats that say no, and the one that must not.**
 *
 * A trip's certification, specialty, and nitrox gates are checked when the seat
 * is *sold* now, not only when the diver boards (ADR
 * 20260803-trip-admission-at-booking, `src/lib/trip-admission.ts`). Until this
 * scenario the demo shop could not show that at all: every non-course charter
 * stated the shop's default Open Water gate, which every carded diver clears,
 * and the two charters that *do* demand more (the Spiegel Grove and the Duane)
 * demand a level, a specialty, and nitrox all at once — so a refusal on either
 * one says three things and demonstrates none of them.
 *
 * So this seeds four departures, each of which can only be refused for exactly
 * one reason, plus the case the gate must never fire on:
 *
 * | Departure | What it demands | Who it turns away |
 * | --- | --- | --- |
 * | Advanced Open Water Diver — two-day course | the *course's* Open Water baseline | nobody: it dives a site gated `advanced_open_water` + Deep, and the carve-out is that a student is never refused the course that grants the card |
 * | Advanced Drift — French Reef Wall | Advanced Open Water, nothing else | a verified Open Water diver — a **level** refusal, which has no missing card to add |
 * | Deep Adventure — USCGC Duane | the site's Deep specialty (no nitrox, unlike the other Duane sailings) | a diver of *any* rung with no Deep card — a **specialty** refusal, where "add the card" is the right advice |
 * | Nitrox Two-Tank — Benwood Wreck | an enriched-air card, at Open Water | a carded diver with no EANx card — a **nitrox** refusal |
 *
 * The refusal subjects are already on file and are deliberately *not* booked
 * onto these boats: Diego Alvarez (verified Open Water), the new Odile Marchand
 * (a verified **Instructor** — the top rung, refused anyway, which is the whole
 * point of a specialty gate), and any carded diver with no EANx card.
 *
 * **Odile is the one person this scenario adds**, and she is added here rather
 * than appended to `seed-cast.ts`'s `customerDefs` on purpose: `seed-more-trips.ts`
 * draws its rosters by walking that list modulo its length, so lengthening it
 * would silently re-deal every roster in the month and move every baseline that
 * names a diver. No new *staff* is added — Marcus takes the AOW session on two
 * days no other seeded course claims.
 *
 * **Called last by the orchestrator** so that every row seeded before it keeps
 * the exact `nextCreatedAt()` stamp it had (the counter is shared across
 * scenarios — see `seed-clock.ts`), and the only difference this scenario makes
 * to the fixture is the rows it adds itself.
 */
export async function seedCertGates(
  db: DbExecutor,
  shopId: string,
  ctx: {
    customers: { id: string }[];
    siteByName: Map<string, typeof diveSites.$inferSelect>;
    courseRows: (typeof courses.$inferSelect)[];
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

  // The two departures that carry a *site's* own gate need the Duane to exist;
  // the rest name their site by the same string `siteByName` is keyed on.
  const duane = siteByName.get("USCGC Duane");
  const advancedCourse = courseRows.find((course) => course.title === "Advanced Open Water Diver");

  /**
   * A diver whose card sits at the very top of the ladder and who holds no
   * specialty card at all. Nothing about her rung can explain a refusal, so the
   * one she gets on the Duane is unambiguously about the Deep card — the case
   * `shared.tripAdmission.cards` exists for, and the one no seeded diver could
   * produce before (every diver missing a Deep card was also short of the
   * level, so the two sentences always rendered together).
   *
   * Booked on nothing, like Hana Kobayashi and for the same reason: carding her
   * cannot flip any seeded trip's readiness, manifest, or Today queue.
   */
  const [instructorDiver] = await db
    .insert(people)
    .values({
      shopId,
      fullName: "Odile Marchand",
      email: "odile.marchand@example.com",
      phone: "+33-1-555-0313",
      emergencyContactName: "Luc Marchand (husband)",
      emergencyContactPhone: "+33-1-555-0314",
    })
    .returning();
  if (!instructorDiver) throw new Error("seed: cert-gate instructor diver insert returned no row");
  await db.insert(personRoles).values({ personId: instructorDiver.id, role: "diver" as const });
  await db.insert(certifications).values({
    shopId,
    personId: instructorDiver.id,
    agency: "padi" as const,
    level: "instructor" as const,
    identifier: "DEMO-GATE-0001",
    status: "verified" as const,
    ...reviewedBy(ctx.instructorId),
    createdAt: nextCreatedAt(),
  });

  type GateTripDef = {
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    plannedDives: number;
    siteName?: string;
    courseId?: string;
    /** The trip's own row — the site's inherent gate merges in at read time. */
    minimumCertificationLevel: (typeof courses.$inferSelect)["minimumCertificationLevel"];
    requiredSpecialties: DiveSpecialty[];
    requiresNitrox: boolean;
    /** Indexes into the seeded diver list — divers who *do* clear this gate. */
    roster: number[];
    /** Every meeting window, when a session meets on more than one day. */
    days?: Array<{ startsAt: Date; endsAt: Date }>;
  };

  /**
   * Days 29-32 on purpose. Every seeded course session already claims a window
   * of Marcus's (days 4, 8, 9-11, 12, 13, 15-17, 20-21, 26-27, and the far-out
   * ones), and days 22 and 24 are reserved by specs that create their own
   * Marcus-crewed session — 29 and 30 are clear of all of them. It also keeps
   * these departures off the public schedule's first page and out of the
   * current month's calendar, so they add a boat to the board without
   * rearranging the surfaces a visitor sees first.
   *
   * Remaining-seat counts avoid the two the e2e fleet matches trips by: no
   * seeded trip may read "3 spots left" but today's reef trip, none may leave
   * six (a spec creates its own six-seat boat), and none may read Full but the
   * wreck charter.
   */
  const tripDefs: GateTripDef[] = [
    ...(advancedCourse && duane
      ? [
          {
            title: "Advanced Open Water Diver — two-day course",
            description:
              "Five adventure dives over two days, including the deep dive on the Duane.",
            startsAt: at(29, 8, 0),
            endsAt: at(30, 16, 0),
            capacity: 5,
            plannedDives: 3,
            siteName: "USCGC Duane",
            courseId: advancedCourse.id,
            // The course's own catalog baseline, verbatim — the same rule
            // `createTrip` applies to any session. The Duane's AOW + Deep is
            // the site's rule for the dive and is deliberately *not* an
            // enrolment gate on top of it.
            minimumCertificationLevel: advancedCourse.minimumCertificationLevel,
            requiredSpecialties: [] as DiveSpecialty[],
            requiresNitrox: false,
            // One Open Water student, seated on a session whose itinerary
            // demands Advanced Open Water and Deep. That seat is the carve-out,
            // made visible: she is admitted, and the instructor still sees the
            // site's blocker against her name on the roster.
            roster: [43],
            days: [
              { startsAt: at(29, 8, 0), endsAt: at(29, 16, 0) },
              { startsAt: at(30, 8, 0), endsAt: at(30, 16, 0) },
            ],
          },
        ]
      : []),
    {
      title: "Advanced Drift — French Reef Wall",
      description: "A current-swept wall for divers already past their first fifty. AOW required.",
      startsAt: at(31, 9, 0),
      endsAt: at(31, 13, 0),
      capacity: 10,
      plannedDives: 2,
      siteName: "French Reef",
      // A level and nothing else: French Reef carries no gate of its own, so a
      // refusal here can only ever be about the rung the diver stands on.
      minimumCertificationLevel: "advanced_open_water" as const,
      requiredSpecialties: [] as DiveSpecialty[],
      requiresNitrox: false,
      roster: [33, 40, 46],
    },
    {
      title: "Deep Adventure — USCGC Duane",
      description: "A third sailing to the Duane, on air. AOW + Deep required by the site itself.",
      startsAt: at(31, 14, 0),
      endsAt: at(31, 18, 0),
      capacity: 8,
      plannedDives: 2,
      siteName: "USCGC Duane",
      // Deliberately *not* nitrox-required, unlike the shop's other two Duane
      // charters: this is the one sailing where a missing Deep card is the only
      // thing that can refuse a seat.
      minimumCertificationLevel: "open_water" as const,
      requiredSpecialties: [] as DiveSpecialty[],
      requiresNitrox: false,
      roster: [18, 19, 20],
    },
    {
      title: "Nitrox Two-Tank — Benwood Wreck",
      description:
        "Long, shallow bottom time on EANx32. Enriched-air certification required to board.",
      startsAt: at(32, 8, 30),
      endsAt: at(32, 12, 30),
      capacity: 9,
      plannedDives: 2,
      siteName: "Benwood Wreck",
      // Open Water, no specialty — so the only card that can be missing is the
      // enriched-air one.
      minimumCertificationLevel: "open_water" as const,
      requiredSpecialties: [] as DiveSpecialty[],
      requiresNitrox: true,
      roster: [18, 19],
    },
  ];

  const insertedTrips = await db
    .insert(trips)
    .values(
      tripDefs.map((def) => ({
        shopId,
        diveSiteId: def.siteName ? siteByName.get(def.siteName)?.id : undefined,
        courseId: def.courseId,
        title: def.title,
        description: def.description,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        capacity: def.capacity,
        plannedDives: def.plannedDives,
      })),
    )
    .returning();

  await db.insert(tripScheduleDays).values(
    insertedTrips.flatMap((trip, i) => {
      const def = tripDefs[i];
      if (!def) return [];
      const days = def.days ?? [{ startsAt: def.startsAt, endsAt: def.endsAt }];
      return days.map((day, dayIndex) => ({
        tripId: trip.id,
        dayNumber: dayIndex + 1,
        startsAt: day.startsAt,
        endsAt: day.endsAt,
      }));
    }),
  );

  // Unnamed dives, the way a charter looks before anyone has written the plan —
  // but the first one carries the trip's site, which is what makes the
  // itinerary's own gate reachable through `tripVisitedSites`.
  await db.insert(tripDives).values(
    insertedTrips.flatMap((trip) =>
      Array.from({ length: trip.plannedDives }, (_, index) => ({
        tripId: trip.id,
        diveNumber: index + 1,
        diveSiteId: index === 0 ? (trip.diveSiteId ?? null) : null,
      })),
    ),
  );

  await db.insert(tripRequirements).values(
    insertedTrips.map((trip, i) => ({
      tripId: trip.id,
      shopId,
      requiresWaiver: true,
      minimumCertificationLevel: tripDefs[i]?.minimumCertificationLevel ?? null,
      requiredSpecialties: tripDefs[i]?.requiredSpecialties ?? [],
      requiresNitrox: tripDefs[i]?.requiresNitrox ?? false,
      requiresPayment: false,
    })),
  );

  await db.insert(tripAssignments).values(
    insertedTrips.flatMap((trip) => {
      if (trip.courseId) {
        return [
          { tripId: trip.id, personId: instructorId, tripRole: "instructor" as TripAssignmentRole },
          ...(captainId
            ? [{ tripId: trip.id, personId: captainId, tripRole: "captain" as TripAssignmentRole }]
            : []),
        ];
      }
      return [
        ...(captainId
          ? [{ tripId: trip.id, personId: captainId, tripRole: "captain" as TripAssignmentRole }]
          : []),
        ...(divemasterId
          ? [
              {
                tripId: trip.id,
                personId: divemasterId,
                tripRole: "divemaster" as TripAssignmentRole,
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
        (tripDefs[i]?.roster ?? [])
          .map((index) => customers[index])
          .filter((person): person is { id: string } => person !== undefined)
          .map((person) => ({
            shopId,
            tripId: trip.id,
            personId: person.id,
            status: "booked" as const,
            createdAt: nextCreatedAt(),
          })),
      ),
    )
    .returning();

  // Every one of these seats is signed. A waiver blocker here would be noise:
  // the whole point of these four boats is that the *only* thing standing
  // between a diver and this roster is a card, so the roster has to be clean of
  // everything else — including for the Open Water student, whose one remaining
  // blocker is then exactly the site gate the carve-out let her book past.
  let gateWaiverToken = 0;
  const waiverRows = insertedBookings.map((booking) => {
    gateWaiverToken++;
    const createdAt = nextCreatedAt();
    return {
      shopId,
      bookingId: booking.id,
      personId: booking.personId,
      templateId: ctx.waiverTemplate.id,
      templateTitle: ctx.waiverTemplate.title,
      templateVersion: ctx.waiverTemplate.version,
      templateGeneration: ctx.waiverTemplate.materialGeneration,
      templateBody: ctx.waiverTemplate.body,
      // Unique per shop row, so a fleet of minted demo shops never collides on
      // the table's global tokenHash constraint.
      tokenHash: `seed-cert-gate-waiver-${shopId}-${gateWaiverToken}`,
      // Comfortably past the furthest departure seeded here (day 32).
      expiresAt: at(60, 12),
      createdAt,
      status: "completed" as const,
      signedName: "Signed on file",
      signatureMethod: "in_person" as const,
      consentedAt: createdAt,
      signedAt: createdAt,
      completedAt: createdAt,
    };
  });
  if (waiverRows.length > 0) await db.insert(waiverRecords).values(waiverRows);
}
