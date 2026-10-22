import { and, asc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { depthToMeters } from "@/lib/depth-units";
import { shopDayBounds } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { listTripReadiness } from "./readiness";
import {
  boats,
  bookingPayments,
  bookings,
  buddyPairMembers,
  buddyTeamEvents,
  certifications,
  type DiveSpecialty,
  diveSites,
  executedDives,
  people,
  personRoles,
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  type TripAssignmentRole,
  tripAssignments,
  tripDives,
  tripLenses,
  tripRequirements,
  trips,
  waiverRecords,
} from "./schema";
import { LEAD_INSTRUCTOR_NAME, OWNER_NAME, RELIEF_INSTRUCTOR_NAME } from "./seed-cast";
import {
  DEMO_SHOP_TIMEZONE,
  type DemoAtSeaDeparture,
  demoAtSeaDeparture,
  withinDeskHours,
} from "./seed-clock";
import { paperRelease } from "./seed-paper-release";
import { liveTrip } from "./trips-live";
import { getCurrentWaiverTemplate } from "./waivers";

/**
 * Who crews the boat at sea, by name, and the job each does aboard: the owner
 * skippers and stays on the boat, and both instructors guide in the water,
 * two guides for eleven divers at the shop's six to one. Nobody on the dawn
 * boat or the readiness departure, so nobody is on two hulls at once.
 */
export const AT_SEA_CREW: readonly { fullName: string; tripRole: TripAssignmentRole }[] = [
  { fullName: OWNER_NAME, tripRole: "captain" },
  { fullName: LEAD_INSTRUCTOR_NAME, tripRole: "divemaster" },
  { fullName: RELIEF_INSTRUCTOR_NAME, tripRole: "divemaster" },
];

/** The boat at sea's names, by day and at dusk. */
export const AT_SEA_DAY_TITLE = "Two-Tank Reef — Pickles & Molasses";
export const AT_SEA_DUSK_TITLE = "Dusk & Night Two-Tank — French Reef";

/** Divers aboard, and how many are still to come up from dive 2. */
export const AT_SEA_ABOARD = 11;
export const AT_SEA_STILL_DOWN = 2;

/**
 * How many days ahead each seat was booked, in seat order: a weekend regular
 * three weeks out, a couple the week before, the walk-ups the day before.
 */
const BOOKED_DAYS_AHEAD = [21, 14, 14, 9, 7, 6, 4, 3, 2, 1, 1] as const;

/**
 * The buddy teams the guides formed at the dock, by seat: four pairs and a
 * trio. The last pair is the one still down.
 */
const TEAMS: readonly (readonly number[])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7, 8],
  [9, 10],
];

/** Minutes before `now` each team of dive 2 was counted back aboard; the last is still down. */
const SURFACED_BEFORE_NOW_MIN = [12, 9, 6, 3] as const;

/**
 * **A boat at sea, halfway through her roll call** (market sheet 2026-10-22,
 * item 1). Whatever hour a visitor opens or resets the demo, one boat is
 * underway: her pre-departure check ticked at the dock, everyone counted
 * aboard as the lines came off, dive 1 in the log and counted, and dive 2's
 * count open with nine of eleven back aboard and one buddy pair still to
 * surface. The roll call a shop's home page leads with is seen while it is
 * happening, not only finished (the dawn boat) or not started (the readiness
 * departure).
 *
 * Every time comes from `demoAtSeaDeparture`, relative to the instant of the
 * seed, so nothing is stamped ahead of the clock; outside the hours a boat is
 * plausibly mid-dive it seeds nothing. Her stage taps (boarding, underway) are
 * `seedTripStage`'s, which runs after this.
 *
 * The divers are regulars from the shop's history, picked from people with no
 * seat anywhere from today on: a release signed for this boat satisfies a
 * diver's other bookings too (sign-once), so a diver with a seat on the
 * readiness departure would change the counts its specs assert. Every one is
 * ready by the boarding gate (`listTripReadiness`), which the dock count
 * applies the way `recordRollCall` does.
 */
export async function seedBoatAtSea(db: DbExecutor, shopId: string): Promise<void> {
  const now = nowDate();
  const plan = demoAtSeaDeparture(now, DEMO_SHOP_TIMEZONE);
  if (!plan) return;

  const crew = await atSeaCrew(db, shopId);
  if (crew.length !== AT_SEA_CREW.length) return;
  const captainId = crew.find((member) => member.tripRole === "captain")?.personId as string;

  const sites = new Map(
    (
      await db
        .select({ id: diveSites.id, name: diveSites.name })
        .from(diveSites)
        .where(eq(diveSites.shopId, shopId))
    ).map((site) => [site.name, site.id]),
  );
  const dives = plan.afterDark
    ? [
        {
          title: "French Reef at dusk",
          site: "French Reef",
          description:
            "In before the light goes, along the ledges, so the second tank starts on known ground.",
          maxDepth: { feet: 35, meters: 11 },
        },
        {
          title: "Full dark",
          site: "French Reef",
          description:
            "Torches on the swim-throughs, and a minute with them off at the safety stop.",
          maxDepth: { feet: 30, meters: 9 },
        },
      ]
    : [
        {
          title: "Pickles Reef",
          site: "Pickles Reef",
          description: "Barrel coral heads and the old anchor chain, a gentle first tank.",
          maxDepth: { feet: 25, meters: 8 },
        },
        {
          title: "Molasses Reef",
          site: "Molasses Reef",
          description: "Spur and groove on the outer reef, out along the mooring line and back.",
          maxDepth: { feet: 40, meters: 12 },
        },
      ];
  const [shop] = await db
    .select({ depthUnit: shops.depthUnit })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const depthUnit = shop?.depthUnit ?? "meters";
  const depthOf = (depth: { feet: number; meters: number }) =>
    depthToMeters(depthUnit === "feet" ? depth.feet : depth.meters, depthUnit);
  const [lens] = await db
    .select({ id: tripLenses.id })
    .from(tripLenses)
    .where(
      and(
        eq(tripLenses.shopId, shopId),
        eq(tripLenses.name, plan.afterDark ? "After dark" : "Easygoing reef"),
        isNull(tripLenses.deletedAt),
      ),
    )
    .limit(1);

  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      boatId: await freeHull(db, shopId, plan),
      diveSiteId: sites.get(dives[0]?.site ?? "") ?? null,
      lensId: lens?.id ?? null,
      title: plan.afterDark ? AT_SEA_DUSK_TITLE : AT_SEA_DAY_TITLE,
      description: plan.afterDark
        ? "Sunset on the way out, the first tank at dusk and the second in the dark."
        : "Two shallow reefs, an easy pace, and a long surface interval in between.",
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
      capacity: 12,
      plannedDives: 2,
      priceCents: plan.afterDark ? 12_000 : 9_500,
      // The crew's own reading, taken at the dock before she sailed.
      conditionsSummary: plan.afterDark
        ? "Flat calm at sunset. Torches checked at the dock."
        : "Light east breeze on the outer reef. Good visibility on both moorings.",
      waterTemperatureC: 27,
      visibilityMeters: depthToMeters(depthUnit === "feet" ? 60 : 18, depthUnit),
      surfaceConditions: plan.afterDark ? "Glassy · no swell" : "Light east breeze · gentle chop",
      conditionsUpdatedAt: new Date(plan.startsAt.getTime() - 45 * 60_000),
    })
    .returning();
  if (!trip) throw new Error("seed: the boat at sea was not inserted");

  await db.insert(tripDives).values(
    dives.map((dive, index) => ({
      tripId: trip.id,
      diveNumber: index + 1,
      title: dive.title,
      diveSiteId: sites.get(dive.site) ?? null,
      description: dive.description,
    })),
  );
  // A plain reef boat's gates, the shop's default. No night gate on purpose
  // (#2574): plenty of shops take open-water divers on a guided dusk dive.
  await db.insert(tripRequirements).values({
    tripId: trip.id,
    shopId,
    requiresWaiver: true,
    minimumCertificationLevel: "open_water" as const,
    requiredSpecialties: [] as DiveSpecialty[],
    requiresNitrox: false,
    requiresPayment: false,
  });
  await db.insert(tripAssignments).values(crew.map((member) => ({ tripId: trip.id, ...member })));

  const divers = await seatTheDivers(db, shopId, trip, plan, captainId);
  if (divers.length < AT_SEA_ABOARD) {
    throw new Error(`seed: only ${divers.length} divers are free and ready for the boat at sea`);
  }
  await writeTheRecord(db, shopId, { trip, plan, divers, crew, captainId, depthOf, dives });
}

/** The crew by name, in `AT_SEA_CREW`'s order; empty when the cast is missing one. */
async function atSeaCrew(
  db: DbExecutor,
  shopId: string,
): Promise<{ personId: string; tripRole: TripAssignmentRole }[]> {
  const rows = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(
          people.fullName,
          AT_SEA_CREW.map((member) => member.fullName),
        ),
      ),
    );
  return AT_SEA_CREW.flatMap((member) => {
    const row = rows.find((candidate) => candidate.fullName === member.fullName);
    return row ? [{ personId: row.id, tripRole: member.tripRole }] : [];
  });
}

/** Mantis I, else Mantis II: whichever hull nothing else has out in her hours. */
async function freeHull(
  db: DbExecutor,
  shopId: string,
  plan: DemoAtSeaDeparture,
): Promise<string | null> {
  const fleet = await db
    .select({ id: boats.id, name: boats.name })
    .from(boats)
    .where(eq(boats.shopId, shopId))
    .orderBy(asc(boats.name));
  for (const hull of fleet) {
    const busy = await db
      .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
      .from(trips)
      .where(and(eq(trips.shopId, shopId), eq(trips.boatId, hull.id), liveTrip()));
    const clash = busy.some(
      (other) =>
        other.startsAt.getTime() < plan.endsAt.getTime() &&
        other.endsAt.getTime() > plan.startsAt.getTime(),
    );
    if (!clash) return hull.id;
  }
  return null;
}

type Diver = { personId: string; fullName: string; bookingId: string };

/**
 * Eleven regulars, booked ahead the way a reef boat sells, each with a paid
 * seat and a release signed at the desk; only those the boarding gate clears
 * stay aboard, in seat order.
 */
async function seatTheDivers(
  db: DbExecutor,
  shopId: string,
  trip: typeof trips.$inferSelect,
  plan: DemoAtSeaDeparture,
  recorderId: string,
): Promise<Diver[]> {
  const template = await getCurrentWaiverTemplate(db, shopId);
  if (!template) throw new Error("seed: waiver template missing before the boat at sea");
  const today = shopDayBounds(nowDate(), DEMO_SHOP_TIMEZONE);
  const seated = db
    .selectDistinct({ personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.shopId, shopId), gte(trips.startsAt, today.from)));
  const carded = db
    .select({ personId: certifications.personId })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, shopId),
        eq(certifications.status, "verified"),
        isNull(certifications.deletedAt),
      ),
    );
  const candidates = await db
    .select({ personId: people.id, fullName: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        notInArray(people.id, seated),
        inArray(people.id, carded),
      ),
    )
    .orderBy(asc(people.fullName));

  const divers: Diver[] = [];
  for (const candidate of candidates) {
    if (divers.length === AT_SEA_ABOARD) break;
    const seat = divers.length;
    const bookedAt = new Date(
      plan.startsAt.getTime() -
        (BOOKED_DAYS_AHEAD[seat] ?? 1) * 24 * 60 * 60_000 -
        (seat + 1) * 7 * 60_000,
    );
    const [booking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver" as const,
        shopId,
        tripId: trip.id,
        personId: candidate.personId,
        status: "checked_in" as const,
        createdAt: bookedAt,
      })
      .returning({ id: bookings.id });
    if (!booking) continue;
    await db.insert(bookingPayments).values({
      shopId,
      bookingId: booking.id,
      status: "paid" as const,
      amountCents: trip.priceCents ?? 0,
      currency: "usd",
      createdAt: bookedAt,
      updatedAt: bookedAt,
    });
    // Signed at the desk when they booked, before the shop's evidence seal
    // was switched on (`seed-waiver-evidence.ts`), like the rest of its
    // regulars' releases.
    const signedAt = withinDeskHours(new Date(bookedAt.getTime() + 5 * 60_000));
    await db.insert(waiverRecords).values({
      shopId,
      bookingId: booking.id,
      personId: candidate.personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateGeneration: template.materialGeneration,
      templateBody: template.body,
      tokenHash: `seed-at-sea-waiver-${shopId}-${seat + 1}`,
      expiresAt: new Date(plan.startsAt.getTime() + 60 * 24 * 60 * 60_000),
      createdAt: signedAt,
      ...paperRelease(signedAt, recorderId, candidate.fullName),
    });
    const readiness = await listTripReadiness(db, shopId, trip.id);
    const cleared = readiness.find((row) => row.booking.id === booking.id);
    if (cleared?.readiness.status !== "ready") {
      // Never a seat the dock would turn away: the boat at sea carries only
      // divers the gate cleared, so its roll call reads as a working day.
      await db.delete(waiverRecords).where(eq(waiverRecords.bookingId, booking.id));
      await db.delete(bookingPayments).where(eq(bookingPayments.bookingId, booking.id));
      await db.delete(bookings).where(eq(bookings.id, booking.id));
      continue;
    }
    divers.push({ ...candidate, bookingId: booking.id });
  }
  return divers;
}

/**
 * What the crew has written by now: the dock check, the buddy teams, the
 * counts at the dock and after dive 1, dive 1's log, and dive 2's count as far
 * as it has got, the last pair still to surface.
 */
async function writeTheRecord(
  db: DbExecutor,
  shopId: string,
  ctx: {
    trip: typeof trips.$inferSelect;
    plan: DemoAtSeaDeparture;
    divers: Diver[];
    crew: { personId: string; tripRole: TripAssignmentRole }[];
    captainId: string;
    depthOf: (depth: { feet: number; meters: number }) => number;
    dives: { site: string; maxDepth: { feet: number; meters: number } }[];
  },
): Promise<void> {
  const { trip, plan, divers, crew, captainId } = ctx;
  const minute = 60_000;
  const now = nowDate();
  const guideId = crew.find((member) => member.tripRole === "divemaster")?.personId ?? captainId;

  // The skipper's safety check, a quarter of an hour before the lines came off.
  const items = await db
    .select({ id: preDepartureChecklistItems.id })
    .from(preDepartureChecklistItems)
    .where(
      and(
        eq(preDepartureChecklistItems.shopId, shopId),
        isNull(preDepartureChecklistItems.deletedAt),
      ),
    )
    .orderBy(preDepartureChecklistItems.sortOrder);
  if (items.length > 0) {
    await db.insert(preDepartureCheckEvents).values(
      items.map((item, index) => ({
        shopId,
        tripId: trip.id,
        checklistItemId: item.id,
        recordedByPersonId: captainId,
        status: "checked" as const,
        occurredAt: new Date(plan.startsAt.getTime() - (15 - index) * minute),
      })),
    );
  }

  // The guides pair the boat at the dock, ten minutes before she sails.
  const [guide] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, guideId))
    .limit(1);
  for (const [index, seats] of TEAMS.entries()) {
    const members = seats.flatMap((seat) => (divers[seat] ? [divers[seat]] : []));
    if (members.length < 2) continue;
    const formedAt = new Date(plan.startsAt.getTime() - (10 + TEAMS.length - index) * minute);
    const pairId = crypto.randomUUID();
    await db.insert(buddyPairMembers).values(
      members.map((member) => ({
        shopId,
        tripId: trip.id,
        pairId,
        bookingId: member.bookingId,
        pairedByPersonId: guideId,
        createdAt: formedAt,
      })),
    );
    await db.insert(buddyTeamEvents).values({
      shopId,
      tripId: trip.id,
      pairId,
      action: "formed",
      memberNames: members.map((member) => member.fullName).sort((a, b) => a.localeCompare(b)),
      recordedByPersonId: guide ? guideId : captainId,
      occurredAt: formedAt,
    });
  }

  // The skipper counts every head as it comes up the ladder: everyone at the
  // dock, everyone after dive 1, and dive 2's count as far as it has got.
  const surfacedAt = new Map<number, Date>();
  TEAMS.forEach((seats, index) => {
    const before = SURFACED_BEFORE_NOW_MIN[index];
    if (before === undefined) return;
    for (const seat of seats) surfacedAt.set(seat, new Date(now.getTime() - before * minute));
  });
  const diverRows = divers.flatMap((diver, seat) => {
    const mark = (checkpoint: string, occurredAt: Date) => ({
      shopId,
      tripId: trip.id,
      bookingId: diver.bookingId,
      recordedByPersonId: captainId,
      status: "boarded" as const,
      checkpoint,
      source: "live" as const,
      occurredAt: new Date(occurredAt.getTime() + seat * 1_000),
    });
    const back = surfacedAt.get(seat);
    return [
      mark("departure", plan.startsAt),
      mark("after_dive_1", plan.diveOne.countedAt),
      ...(back ? [mark("after_dive_2", back)] : []),
    ];
  });
  await db.insert(rollCallEvents).values(diverRows);

  // The crew counted at the same checkpoints. The skipper never left the
  // boat and the first guide came up with her group; the second guide is
  // still down with the last pair, so a pair is never left in the water
  // unguided, and her own count stays open beside theirs.
  const firstGuideBack = new Date(now.getTime() - (SURFACED_BEFORE_NOW_MIN.at(-1) ?? 3) * minute);
  const lastGuideId = crew.filter((member) => member.tripRole === "divemaster").at(-1)?.personId;
  await db.insert(rollCallCrewEvents).values(
    crew.flatMap((member, index) =>
      [
        { checkpoint: "departure", occurredAt: plan.startsAt },
        { checkpoint: "after_dive_1", occurredAt: plan.diveOne.countedAt },
        ...(member.personId === lastGuideId
          ? []
          : [{ checkpoint: "after_dive_2", occurredAt: firstGuideBack }]),
      ].map(({ checkpoint, occurredAt }) => ({
        shopId,
        tripId: trip.id,
        personId: member.personId,
        recordedByPersonId: captainId,
        status: "boarded" as const,
        checkpoint,
        source: "live" as const,
        occurredAt: new Date(occurredAt.getTime() + (divers.length + index) * 1_000),
      })),
    ),
  );

  // Dive 1 in the log; dive 2 is still in the water, so nobody has logged it.
  const firstDive = ctx.dives[0];
  await db.insert(executedDives).values({
    shopId,
    tripId: trip.id,
    diveNumber: 1,
    actualSiteId: trip.diveSiteId,
    enteredAt: plan.diveOne.enteredAt,
    exitedAt: plan.diveOne.exitedAt,
    maxDepthMeters: firstDive ? ctx.depthOf(firstDive.maxDepth) : null,
    recordedByPersonId: captainId,
  });
}
