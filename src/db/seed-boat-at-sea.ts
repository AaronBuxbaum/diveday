import { and, asc, eq, gte, inArray, isNull, lte, notInArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { depthToMeters } from "@/lib/depth-units";
import { shopDayBounds } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { isDemoShopWithDemoOwnerOrCaptainAccount } from "./demo-account-guard";
import { listTripReadiness } from "./readiness";
import {
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
  type DemoFinishedDuskDeparture,
  demoAtSeaDeparture,
  demoFinishedDuskDeparture,
  withinDeskHours,
} from "./seed-clock";
import { freeHull } from "./seed-hulls";
import { AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE } from "./seed-identifiers";
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

export { AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE } from "./seed-identifiers";

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
 * How many teams the first guide leads: the first three, six divers at the
 * shop's six to one. She surfaces with the third; the trio and the last pair
 * are the second guide's five, the trio sent up ahead of her.
 */
const FIRST_GUIDE_TEAMS = 3;

/**
 * **A boat at sea during booth hours, a finished dusk roll call after hours**
 * (market sheet 2026-10-22, item 1; issue #3177). In booth hours the record is
 * underway with dive 1 counted and dive 2's count open. Outside those hours,
 * it is the last completed dusk departure, with every diver and crew member
 * counted back. A 5 AM demo therefore keeps last night's real date and finish
 * time; it does not put a boat in the water overnight.
 *
 * Every time comes from the demo clock helpers, and completed roll-call events
 * stay behind the seed instant. Her stage taps (boarding, underway, returned)
 * are `seedTripStage`'s, which runs after this.
 *
 * The divers are regulars from the shop's history, picked from people with no
 * seat anywhere from today on: a release signed for this boat satisfies a
 * diver's other bookings too (sign-once), so a diver with a seat on the
 * readiness departure would change the counts its specs assert. Every one is
 * ready by the boarding gate (`listTripReadiness`), which the dock count
 * applies the way `recordRollCall` does.
 */
export async function seedBoatAtSea(db: DbExecutor, shopId: string): Promise<void> {
  await db.transaction((tx) => seedBoatAtSeaWithinTransaction(tx, shopId));
}

async function seedBoatAtSeaWithinTransaction(db: DbExecutor, shopId: string): Promise<void> {
  if (!(await isDemoShopWithDemoOwnerOrCaptainAccount(db, shopId))) return;
  const now = nowDate();
  const plan =
    demoAtSeaDeparture(now, DEMO_SHOP_TIMEZONE) ??
    demoFinishedDuskDeparture(now, DEMO_SHOP_TIMEZONE);
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
  const dives = atSeaDives(plan.afterDark);
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
  await writeTheRecord(db, shopId, {
    trip,
    plan,
    divers,
    crew,
    captainId,
    depthOf,
    dives,
    diveOneSiteId: sites.get(dives[0]?.site ?? "") ?? null,
  });
}

/** The boat at sea's two dives: the day boat's, or the dusk boat's. */
function atSeaDives(afterDark: boolean): {
  title: string;
  site: string;
  description: string;
  maxDepth: { feet: number; meters: number };
}[] {
  return afterDark
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
            "Torches along the ledges, and a minute with them covered on the sand for the bioluminescence.",
          maxDepth: { feet: 30, meters: 9 },
        },
      ]
    : // Deepest dive first, the way a captain briefs a two-tank.
      [
        {
          title: "Molasses Reef",
          site: "Molasses Reef",
          description: "Spur and groove on the outer reef, out along the mooring line and back.",
          maxDepth: { feet: 40, meters: 12 },
        },
        {
          title: "Pickles Reef",
          site: "Pickles Reef",
          description: "Barrel coral heads and the old anchor chain, a shallower second tank.",
          maxDepth: { feet: 25, meters: 8 },
        },
      ];
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

  // Who the boarding gate clears is asked once, of every candidate seated at
  // once, rather than one whole-roster readiness read per seat (it ran on
  // every e2e reset). The probe seats come out again and only the cleared
  // divers are seated, in seat order.
  const probe = await writeSeats(db, shopId, trip, plan, recorderId, template, candidates, "probe");
  const readiness = await listTripReadiness(db, shopId, trip.id);
  const ready = new Set(
    readiness.flatMap((row) => (row.readiness.status === "ready" ? [row.booking.id] : [])),
  );
  const cleared = probe
    .filter((seat) => ready.has(seat.bookingId))
    .slice(0, AT_SEA_ABOARD)
    .map(({ personId, fullName }) => ({ personId, fullName }));
  const probeIds = probe.map((seat) => seat.bookingId);
  if (probeIds.length > 0) {
    await db.delete(waiverRecords).where(inArray(waiverRecords.bookingId, probeIds));
    await db.delete(bookingPayments).where(inArray(bookingPayments.bookingId, probeIds));
    await db.delete(bookings).where(inArray(bookings.id, probeIds));
  }
  return writeSeats(db, shopId, trip, plan, recorderId, template, cleared, "seat");
}

/**
 * A paid, checked-in seat and a release signed at the desk for each diver,
 * in seat order: booked ahead the way a reef boat sells, each release signed
 * when they booked, before the shop's evidence seal was switched on
 * (`seed-waiver-evidence.ts`), like the rest of its regulars' releases.
 */
async function writeSeats(
  db: DbExecutor,
  shopId: string,
  trip: typeof trips.$inferSelect,
  plan: DemoAtSeaDeparture,
  recorderId: string,
  template: NonNullable<Awaited<ReturnType<typeof getCurrentWaiverTemplate>>>,
  divers: readonly { personId: string; fullName: string }[],
  tokenKind: "probe" | "seat",
): Promise<Diver[]> {
  if (divers.length === 0) return [];
  const bookedAt = divers.map(
    (_, seat) =>
      new Date(
        plan.startsAt.getTime() -
          (BOOKED_DAYS_AHEAD[seat] ?? 1) * 24 * 60 * 60_000 -
          (seat + 1) * 7 * 60_000,
      ),
  );
  const rows = await db
    .insert(bookings)
    .values(
      divers.map((diver, seat) => ({
        bookedAs: "diver" as const,
        shopId,
        tripId: trip.id,
        personId: diver.personId,
        status: "checked_in" as const,
        createdAt: bookedAt[seat] as Date,
      })),
    )
    .returning({ id: bookings.id, personId: bookings.personId });
  const bookingOf = new Map(rows.map((row) => [row.personId, row.id]));
  const seated = divers.flatMap((diver, seat) => {
    const bookingId = bookingOf.get(diver.personId);
    return bookingId ? [{ ...diver, bookingId, seat, at: bookedAt[seat] as Date }] : [];
  });
  await db.insert(bookingPayments).values(
    seated.map((row) => ({
      shopId,
      bookingId: row.bookingId,
      status: "paid" as const,
      amountCents: trip.priceCents ?? 0,
      currency: "usd",
      createdAt: row.at,
      updatedAt: row.at,
    })),
  );
  await db.insert(waiverRecords).values(
    seated.map((row) => {
      const signedAt = withinDeskHours(new Date(row.at.getTime() + 5 * 60_000));
      return {
        shopId,
        bookingId: row.bookingId,
        personId: row.personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateGeneration: template.materialGeneration,
        templateBody: template.body,
        tokenHash:
          tokenKind === "seat"
            ? `seed-at-sea-waiver-${shopId}-${row.seat + 1}`
            : `seed-at-sea-probe-${shopId}-${row.seat + 1}`,
        expiresAt: new Date(plan.startsAt.getTime() + 60 * 24 * 60 * 60_000),
        createdAt: signedAt,
        ...paperRelease(signedAt, recorderId, row.fullName),
      };
    }),
  );
  return seated.map(({ personId, fullName, bookingId }) => ({ personId, fullName, bookingId }));
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
    plan: DemoAtSeaDeparture | DemoFinishedDuskDeparture;
    divers: Diver[];
    crew: { personId: string; tripRole: TripAssignmentRole }[];
    captainId: string;
    depthOf: (depth: { feet: number; meters: number }) => number;
    dives: { site: string; maxDepth: { feet: number; meters: number } }[];
    diveOneSiteId: string | null;
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
  if ("finishedAt" in plan) {
    TEAMS.forEach((seats, index) => {
      const minutesBeforeClose = (TEAMS.length - 1 - index) * 5;
      const teamCountAt = new Date(
        plan.finishedAt.getTime() - minutesBeforeClose * minute - 10_000,
      );
      for (const seat of seats) surfacedAt.set(seat, teamCountAt);
    });
  } else {
    TEAMS.forEach((seats, index) => {
      const before = SURFACED_BEFORE_NOW_MIN[index];
      if (before === undefined) return;
      for (const seat of seats) surfacedAt.set(seat, new Date(now.getTime() - before * minute));
    });
  }
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
  // boat and the first guide came up with the last of her six; the second
  // guide is still down with the last pair, so a pair is never left in the
  // water unguided, and her own count stays open beside theirs.
  const firstGuideBack =
    "finishedAt" in plan
      ? new Date(plan.finishedAt.getTime() - 30_000)
      : new Date(now.getTime() - (SURFACED_BEFORE_NOW_MIN[FIRST_GUIDE_TEAMS - 1] ?? 6) * minute);
  const lastGuideId = crew.filter((member) => member.tripRole === "divemaster").at(-1)?.personId;
  await db.insert(rollCallCrewEvents).values(
    crew.flatMap((member, index) =>
      [
        { checkpoint: "departure", occurredAt: plan.startsAt },
        { checkpoint: "after_dive_1", occurredAt: plan.diveOne.countedAt },
        ...(member.personId === lastGuideId && !("finishedAt" in plan)
          ? []
          : [
              {
                checkpoint: "after_dive_2",
                occurredAt:
                  "finishedAt" in plan && member.personId === lastGuideId
                    ? new Date(plan.finishedAt.getTime() - 15_000)
                    : firstGuideBack,
              },
            ]),
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

  // Dive 1 is logged in both versions. A finished dusk departure also has the
  // second dive in its record; the active boat keeps it open until homecoming.
  const firstDive = ctx.dives[0];
  const executed = [
    {
      shopId,
      tripId: trip.id,
      diveNumber: 1,
      actualSiteId: ctx.diveOneSiteId,
      enteredAt: plan.diveOne.enteredAt,
      exitedAt: plan.diveOne.exitedAt,
      maxDepthMeters: firstDive ? ctx.depthOf(firstDive.maxDepth) : null,
      recordedByPersonId: captainId,
    },
  ];
  if ("finishedAt" in plan) {
    const secondDive = ctx.dives[1];
    const [plannedSecond] = await db
      .select({ diveSiteId: tripDives.diveSiteId })
      .from(tripDives)
      .where(and(eq(tripDives.tripId, trip.id), eq(tripDives.diveNumber, 2)))
      .limit(1);
    executed.push({
      shopId,
      tripId: trip.id,
      diveNumber: 2,
      actualSiteId: plannedSecond?.diveSiteId ?? null,
      enteredAt: plan.diveTwoEnteredAt,
      exitedAt: new Date(plan.finishedAt.getTime() - LAST_PAIR_UP_AFTER_LAST_COUNT_MIN * minute),
      maxDepthMeters: secondDive ? ctx.depthOf(secondDive.maxDepth) : null,
      recordedByPersonId: captainId,
    });
  }
  await db.insert(executedDives).values(executed);
}

/** How long after the last count the last pair and their guide come up the ladder. */
const LAST_PAIR_UP_AFTER_LAST_COUNT_MIN = 4;
/** How long dive 2 ran, from going in to the last diver up. */
const DIVE_TWO_RAN_MIN = 55;

/**
 * **The boat at sea comes home** (dive-domain review of the demo reseed, item
 * 3). The seed writes her record as of the instant it ran, dive 2's count
 * open with the last pair and a guide still down, and nothing else ever
 * closes it: a demo seeded at 10 AM still showed two divers and a guide never
 * counted back at 3 PM, and on every later day. A captain reads that as people
 * lost hours ago with nobody raising the alarm.
 *
 * For every demo shop's boat at sea past her `endsAt` with dive 2 not yet in
 * the log, this writes what the crew would have: the last pair's and the
 * guide's `after_dive_2` marks, a few minutes after the last count, and dive
 * 2's log. Never a mark ahead of `now`, never on a shop that is not a demo or
 * a boat a visitor cancelled, and a boat whose dive 2 is logged is left alone.
 * Each boat is written in its own transaction under her row lock, so a second
 * pass, even one running at the same time, writes nothing. Returns how many
 * boats it brought home.
 */
export async function bringDemoBoatsAtSeaHome(
  db: DbExecutor,
  now: Date = nowDate(),
): Promise<number> {
  const due = await db
    .select({
      id: trips.id,
      shopId: trips.shopId,
      title: trips.title,
      endsAt: trips.endsAt,
      depthUnit: shops.depthUnit,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        eq(shops.isDemo, true),
        inArray(trips.title, [AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE]),
        // A visitor who cancelled her gets no dive 2 log: under H-84 that
        // would turn a cancelled departure into a dive day for every seat.
        eq(trips.status, "scheduled"),
        lte(trips.endsAt, now),
        liveTrip(),
      ),
    );
  let home = 0;
  for (const trip of due) {
    // One boat at a time, under her row lock, asked again inside it: a doubled
    // cron delivery waits here, then finds dive 2 logged and writes nothing.
    if (await db.transaction((tx) => bringBoatHome(tx, trip, now))) home++;
  }
  return home;
}

/** One boat at sea brought home, or left alone; true when this call wrote her return. */
async function bringBoatHome(
  db: DbExecutor,
  trip: {
    id: string;
    shopId: string;
    title: string;
    depthUnit: (typeof shops.$inferSelect)["depthUnit"];
  },
  now: Date,
): Promise<boolean> {
  // Take the shop identity lock before the trip lock. Reset/refresh already
  // hold the shop lock while deleting or reseeding trips; the same order here
  // avoids a trip→shop / shop→trip deadlock with an overlapping hourly pass.
  if (!(await isDemoShopWithDemoOwnerOrCaptainAccount(db, trip.shopId))) return false;
  const [locked] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, trip.id), eq(trips.status, "scheduled"), liveTrip()))
    .limit(1)
    .for("update");
  if (!locked) return false;
  const [logged] = await db
    .select({ id: executedDives.id })
    .from(executedDives)
    .where(and(eq(executedDives.tripId, trip.id), eq(executedDives.diveNumber, 2)))
    .limit(1);
  if (logged) return false;

  const [captain] = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.tripRole, "captain")))
    .limit(1);
  if (!captain) return false;

  const divers = await db
    .select({
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
      occurredAt: rollCallEvents.occurredAt,
    })
    .from(rollCallEvents)
    .where(eq(rollCallEvents.tripId, trip.id))
    // Oldest first, the roll call's own order, so the last row per person is
    // the mark standing now.
    .orderBy(
      asc(rollCallEvents.occurredAt),
      asc(rollCallEvents.createdAt),
      asc(rollCallEvents.seq),
    );
  const crew = await db
    .select({
      personId: rollCallCrewEvents.personId,
      checkpoint: rollCallCrewEvents.checkpoint,
      status: rollCallCrewEvents.status,
      occurredAt: rollCallCrewEvents.occurredAt,
    })
    .from(rollCallCrewEvents)
    .where(eq(rollCallCrewEvents.tripId, trip.id))
    .orderBy(
      asc(rollCallCrewEvents.occurredAt),
      asc(rollCallCrewEvents.createdAt),
      asc(rollCallCrewEvents.seq),
    );

  const lastCount = [...divers, ...crew]
    .filter((row) => row.checkpoint === "after_dive_2")
    .reduce((latest, row) => Math.max(latest, row.occurredAt.getTime()), 0);
  if (lastCount === 0) return false;
  const upAt = new Date(
    Math.min(lastCount + LAST_PAIR_UP_AFTER_LAST_COUNT_MIN * 60_000, now.getTime()),
  );

  // Back only while their newest dive 2 mark is "boarded" (review 2 of issue
  // 2917): a mark taken back reads awaiting and "not boarded" reads missing,
  // and leaving either beside a logged dive 2 keeps her count open for good.
  const countedBack = (rows: { checkpoint: string; status: string }[]) =>
    rows.filter((row) => row.checkpoint === "after_dive_2").at(-1)?.status === "boarded";
  const stillDown = [...new Set(divers.map((row) => row.bookingId))].filter(
    (bookingId) =>
      divers.some((row) => row.bookingId === bookingId && row.checkpoint === "after_dive_1") &&
      !countedBack(divers.filter((row) => row.bookingId === bookingId)),
  );
  const crewDown = [...new Set(crew.map((row) => row.personId))].filter(
    (personId) =>
      crew.some((row) => row.personId === personId && row.checkpoint === "after_dive_1") &&
      !countedBack(crew.filter((row) => row.personId === personId)),
  );
  if (stillDown.length > 0) {
    await db.insert(rollCallEvents).values(
      stillDown.map((bookingId, index) => ({
        shopId: trip.shopId,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: captain.personId,
        status: "boarded" as const,
        checkpoint: "after_dive_2",
        source: "live" as const,
        occurredAt: new Date(upAt.getTime() - (stillDown.length - index) * 1_000),
      })),
    );
  }
  if (crewDown.length > 0) {
    await db.insert(rollCallCrewEvents).values(
      crewDown.map((personId) => ({
        shopId: trip.shopId,
        tripId: trip.id,
        personId,
        recordedByPersonId: captain.personId,
        status: "boarded" as const,
        checkpoint: "after_dive_2",
        source: "live" as const,
        occurredAt: upAt,
      })),
    );
  }

  const [planned] = await db
    .select({ diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(and(eq(tripDives.tripId, trip.id), eq(tripDives.diveNumber, 2)))
    .limit(1);
  const secondDive = atSeaDives(trip.title === AT_SEA_DUSK_TITLE)[1];
  const unit = trip.depthUnit ?? "meters";
  await db.insert(executedDives).values({
    shopId: trip.shopId,
    tripId: trip.id,
    diveNumber: 2,
    actualSiteId: planned?.diveSiteId ?? null,
    enteredAt: new Date(upAt.getTime() - DIVE_TWO_RAN_MIN * 60_000),
    exitedAt: upAt,
    maxDepthMeters: secondDive
      ? depthToMeters(unit === "feet" ? secondDive.maxDepth.feet : secondDive.maxDepth.meters, unit)
      : null,
    recordedByPersonId: captain.personId,
  });
  return true;
}
