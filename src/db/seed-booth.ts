import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { DAY_MS, nowDate } from "@/lib/clock";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { shopDayBounds, utcToWallTime } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import {
  boats,
  bookingPayments,
  bookings,
  certifications,
  courses,
  type DiveSpecialty,
  divePackageEntitlements,
  divePackages,
  diveSites,
  executedDives,
  interests,
  lostItems,
  orderLineItems,
  orders,
  people,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  tripBlowoutDivers,
  tripBlowouts,
  tripDives,
  tripLenses,
  tripRequirements,
  tripScheduleDays,
  trips,
} from "./schema";
import { CAPTAIN_NAME, LEAD_INSTRUCTOR_NAME, OWNER_NAME } from "./seed-cast";
import { at, DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { HISTORY_DIVER_NAMES } from "./seed-history";
import { freeHull } from "./seed-hulls";
import { DEMO_WEEKLY_RUN_TITLE } from "./seed-weekly-run";
import { liveTrip } from "./trips-live";

/**
 * **What a booth visitor is shown in five minutes** (market sheet 2026-10-22,
 * item 4): six facts the demo's features need before they say anything, and
 * nothing beyond them.
 *
 * 1. A regular three dives into a five-dive card, the other two spent on
 *    tomorrow's boat (`seedDiveCard`).
 * 2. A thin 2025, so Reports can say "by this date in 2025"
 *    (`LAST_YEAR_SAILINGS` in `seed-last-year.ts`, sailed by `seedHistory`).
 * 3. Last Saturday's boat, called off for weather, its divers refunded and two
 *    of them moved to this Saturday (`seedWeatherCall`).
 * 4. Two students certified Rescue Diver by the shop, so their recap
 *    carries the card (`seedShopCertified`).
 * 5. A mask left on a recent boat by a diver who is back tomorrow
 *    (`seedLostMask`).
 * 6. The weekly Saturday run full on its next date, with a wait list
 *    (`fillWeeklyRun`, after the run exists).
 *
 * Everyone here is from the history cohort (`HISTORY_DIVER_NAMES`), who carry
 * verified cards and signed releases already, so no seat added here changes
 * a readiness count the other scenarios assert. Rides the history flag.
 */

/** The package the regular holds, as `seedPackages` names it. */
export const DIVE_CARD_PACKAGE = "Five-dive card";
/** What the crew found in the rinse tank. */
export const LOST_MASK = "Blue mask in a yellow box, left in the rinse tank";
/** Last Saturday's boat, which the weather kept in. */
export const WEATHER_CALLED_TITLE = "Saturday Two-Tank — Molasses & French";
/** The session two students finished, and the shop certified. */
export const SHOP_CERTIFIED_TITLE = "Rescue Diver — weekend course";
/** Of the weather call's divers, how many rebooked onto the next Saturday. */
export const WEATHER_MOVED = 2;
/** Divers on the weekly run's wait list for its next date. */
export const WEEKLY_RUN_WAITING = 2;

const WEATHER_PRICE_CENTS = 13_000;
const WEATHER_LEAD_DAYS = [14, 10, 9, 6, 4, 3];

type Cohort = { id: string; fullName: string; level: string }[];

export async function seedBoothStories(db: DbExecutor, shopId: string): Promise<void> {
  const cast = await castIds(db, shopId);
  if (!cast) return;
  const cohort = await historyCohort(db, shopId);
  if (cohort.length === 0) return;
  const used = new Set<string>();
  await seedDiveCard(db, shopId, { cohort, used, ownerId: cast.owner });
  await seedLostMask(db, shopId, { cohort, used, captainId: cast.captain });
  await seedWeatherCall(db, shopId, { cohort, used, ownerId: cast.owner });
  await seedShopCertified(db, shopId, { cohort, used, instructorId: cast.instructor });
}

async function castIds(
  db: DbExecutor,
  shopId: string,
): Promise<{ owner: string; captain: string; instructor: string } | null> {
  const rows = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(people.fullName, [OWNER_NAME, CAPTAIN_NAME, LEAD_INSTRUCTOR_NAME]),
      ),
    );
  const id = (name: string) => rows.find((row) => row.fullName === name)?.id;
  const owner = id(OWNER_NAME);
  const captain = id(CAPTAIN_NAME);
  const instructor = id(LEAD_INSTRUCTOR_NAME);
  return owner && captain && instructor ? { owner, captain, instructor } : null;
}

/** The history cohort with their verified level, in the cohort's own order. */
async function historyCohort(db: DbExecutor, shopId: string): Promise<Cohort> {
  const rows = await db
    .select({ id: people.id, fullName: people.fullName, level: certifications.level })
    .from(people)
    .innerJoin(
      certifications,
      and(
        eq(certifications.personId, people.id),
        eq(certifications.status, "verified"),
        isNull(certifications.deletedAt),
      ),
    )
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(people.fullName, [...HISTORY_DIVER_NAMES]),
        isNull(people.deletedAt),
      ),
    );
  return HISTORY_DIVER_NAMES.flatMap((name) => {
    const row = rows.find((candidate) => candidate.fullName === name);
    return row ? [row] : [];
  });
}

/** Whether the person holds a live seat on any departure overlapping the hours. */
async function busy(
  db: DbExecutor,
  shopId: string,
  personId: string,
  window: { startsAt: Date; endsAt: Date },
): Promise<boolean> {
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, personId),
        ne(bookings.status, "cancelled"),
        liveTrip(),
        lt(trips.startsAt, window.endsAt),
        gt(trips.endsAt, window.startsAt),
      ),
    )
    .limit(1);
  return !!row;
}

async function firstFree(
  db: DbExecutor,
  shopId: string,
  candidates: Cohort,
  used: Set<string>,
  window: { startsAt: Date; endsAt: Date },
  accept: (diver: Cohort[number]) => boolean = () => true,
): Promise<Cohort[number] | null> {
  for (const diver of candidates) {
    if (used.has(diver.id) || !accept(diver)) continue;
    if (await busy(db, shopId, diver.id, window)) continue;
    used.add(diver.id);
    return diver;
  }
  return null;
}

/** Seats taken on a departure, cancelled ones aside. */
async function seatsTaken(db: DbExecutor, tripId: string): Promise<number> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
  return rows.length;
}

/**
 * Tomorrow's first plain boat with two seats to spare: no course, no nitrox
 * gate, in the shop's own day.
 */
async function tomorrowsBoat(db: DbExecutor, shopId: string) {
  const tomorrow = shopDayBounds(new Date(nowDate().getTime() + DAY_MS), DEMO_SHOP_TIMEZONE);
  const rows = await db
    .select({
      trip: trips,
      requiresNitrox: tripRequirements.requiresNitrox,
    })
    .from(trips)
    .leftJoin(tripRequirements, eq(tripRequirements.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(trips.diveMode, "boat"),
        isNull(trips.courseId),
        liveTrip(),
        lt(trips.startsAt, tomorrow.to),
        gt(trips.startsAt, tomorrow.from),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title));
  for (const row of rows) {
    if (row.requiresNitrox) continue;
    if (row.trip.capacity - (await seatsTaken(db, row.trip.id)) >= 2) return row.trip;
  }
  return null;
}

/**
 * **"3 of 5 dives left"**: the cohort's most regular diver bought a five-dive
 * card at the counter five weeks ago, and tomorrow's two-tank boat spent two
 * of it, the way `bookSpot` spends a card (one dive per tank, the seat paid
 * at nothing). Bought before this month, so the month's money is untouched.
 */
async function seedDiveCard(
  db: DbExecutor,
  shopId: string,
  ctx: { cohort: Cohort; used: Set<string>; ownerId: string },
): Promise<void> {
  const [card] = await db
    .select()
    .from(divePackages)
    .where(
      and(
        eq(divePackages.shopId, shopId),
        eq(divePackages.name, DIVE_CARD_PACKAGE),
        isNull(divePackages.deletedAt),
      ),
    )
    .limit(1);
  const boat = await tomorrowsBoat(db, shopId);
  if (!card || !boat) return;
  // The regular: most boats sailed with the shop, ties by name.
  const sailed = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "checked_in"),
        lt(trips.startsAt, nowDate()),
        inArray(
          bookings.personId,
          ctx.cohort.map((diver) => diver.id),
        ),
      ),
    );
  const tally = new Map<string, number>();
  for (const row of sailed) tally.set(row.personId, (tally.get(row.personId) ?? 0) + 1);
  const byVisits = [...ctx.cohort].sort(
    (a, b) =>
      (tally.get(b.id) ?? 0) - (tally.get(a.id) ?? 0) || a.fullName.localeCompare(b.fullName),
  );
  const regular = await firstFree(db, shopId, byVisits, ctx.used, boat);
  if (!regular) return;

  const boughtAt = at(-35, 11, 40);
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      personId: regular.id,
      createdByPersonId: ctx.ownerId,
      status: "paid",
      source: "staff",
      collection: "card_machine",
      currency: "usd",
      totalCents: card.priceCents,
      amountPaidCents: card.priceCents,
      description: card.name,
      finalizedAt: boughtAt,
      paidAt: boughtAt,
      createdAt: boughtAt,
      updatedAt: boughtAt,
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("seed: the dive card order was not written");
  await db.insert(orderLineItems).values({
    shopId,
    orderId: order.id,
    packageId: card.id,
    kind: "dive_package",
    description: card.name,
    quantity: 1,
    unitAmountCents: card.priceCents,
    createdAt: boughtAt,
  });
  const dives = await db
    .insert(divePackageEntitlements)
    .values(
      Array.from({ length: card.diveCount }, () => ({
        shopId,
        packageId: card.id,
        personId: regular.id,
        orderId: order.id,
        createdAt: boughtAt,
      })),
    )
    .returning({ id: divePackageEntitlements.id });

  const bookedAt = at(-3, 15, 10);
  const [seat] = await db
    .insert(bookings)
    .values({
      bookedAs: "diver",
      shopId,
      tripId: boat.id,
      personId: regular.id,
      status: "booked",
      createdAt: bookedAt,
    })
    .returning({ id: bookings.id });
  if (!seat) throw new Error("seed: the dive card seat was not written");
  const spent = dives.slice(0, boat.plannedDives).map((dive) => dive.id);
  await db
    .update(divePackageEntitlements)
    .set({ bookingId: seat.id, consumedAt: bookedAt })
    .where(inArray(divePackageEntitlements.id, spent));
  await db.insert(bookingPayments).values({
    shopId,
    bookingId: seat.id,
    status: "paid",
    amountCents: 0,
    currency: "usd",
    provider: "dive_package",
    providerRef: spent[0] ?? null,
    createdAt: bookedAt,
    updatedAt: bookedAt,
  });
}

/**
 * **A mask in the rinse tank**: the newest boat back from the history cohort
 * left one, its owner is back on tomorrow's boat, and the arrival desk will
 * hand it over. Open, tied to the seat, written by the captain as she
 * hosed down.
 */
async function seedLostMask(
  db: DbExecutor,
  shopId: string,
  ctx: { cohort: Cohort; used: Set<string>; captainId: string },
): Promise<void> {
  const boat = await tomorrowsBoat(db, shopId);
  if (!boat) return;
  const recent = await db
    .select({ trip: trips, bookingId: bookings.id, personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "checked_in"),
        liveTrip(),
        isNull(trips.courseId),
        lt(trips.endsAt, nowDate()),
        inArray(
          bookings.personId,
          ctx.cohort.map((diver) => diver.id),
        ),
      ),
    )
    .orderBy(desc(trips.startsAt), asc(bookings.createdAt))
    .limit(40);
  for (const row of recent) {
    const diver = ctx.cohort.find((candidate) => candidate.id === row.personId);
    if (!diver || ctx.used.has(diver.id)) continue;
    if (await busy(db, shopId, diver.id, boat)) continue;
    ctx.used.add(diver.id);
    const foundAt = new Date(row.trip.endsAt.getTime() + 25 * 60_000);
    await db.insert(lostItems).values({
      shopId,
      tripId: row.trip.id,
      bookingId: row.bookingId,
      personId: diver.id,
      description: LOST_MASK,
      status: "open",
      recordedByPersonId: ctx.captainId,
      createdAt: foundAt,
      updatedAt: foundAt,
    });
    // Rebooked at the desk on the way out, for tomorrow.
    const bookedAt = new Date(foundAt.getTime() + 10 * 60_000);
    const [seat] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId,
        tripId: boat.id,
        personId: diver.id,
        status: "booked",
        createdAt: bookedAt,
      })
      .returning({ id: bookings.id });
    if (!seat) throw new Error("seed: the mask owner's seat was not written");
    await db.insert(bookingPayments).values({
      shopId,
      bookingId: seat.id,
      status: "paid",
      amountCents: boat.priceCents ?? 0,
      currency: "usd",
      createdAt: bookedAt,
      updatedAt: bookedAt,
    });
    return;
  }
}

/** Days back to the last Saturday before the shop's today. */
function daysSinceLastSaturday(now: Date): number {
  const wall = utcToWallTime(now, DEMO_SHOP_TIMEZONE);
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  const back = (weekday - 6 + 7) % 7;
  return back === 0 ? 7 : back;
}

async function siteAndLens(db: DbExecutor, shopId: string, site: string, lens: string) {
  const [siteRow] = await db
    .select({ id: diveSites.id })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), eq(diveSites.name, site)))
    .limit(1);
  const [lensRow] = await db
    .select({ id: tripLenses.id })
    .from(tripLenses)
    .where(
      and(eq(tripLenses.shopId, shopId), eq(tripLenses.name, lens), isNull(tripLenses.deletedAt)),
    )
    .limit(1);
  return { diveSiteId: siteRow?.id ?? null, lensId: lensRow?.id ?? null };
}

/**
 * **Last Saturday, called off for weather.** The owner made the call at 5:15
 * the evening before, every diver was told and refunded in full, and two of
 * them booked the next Saturday inside the hour (`fillWeeklyRun` seats them).
 * Reports reads it as the month's weather line.
 */
async function seedWeatherCall(
  db: DbExecutor,
  shopId: string,
  ctx: { cohort: Cohort; used: Set<string>; ownerId: string },
): Promise<void> {
  const back = daysSinceLastSaturday(nowDate());
  const window = { startsAt: at(-back, 8, 0), endsAt: at(-back, 12, 0) };
  const calledAt = at(-back - 1, 17, 15);
  const { diveSiteId: weatherSiteId, lensId: weatherLensId } = await siteAndLens(
    db,
    shopId,
    "Molasses Reef",
    "Easygoing reef",
  );
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: WEATHER_CALLED_TITLE,
      description: "Two shallow reefs on the outer line, back by noon.",
      ...window,
      capacity: 12,
      plannedDives: 2,
      priceCents: WEATHER_PRICE_CENTS,
      boatId: await freeHull(db, shopId, window),
      lensId: weatherLensId,
      status: "cancelled",
      cancelledAt: calledAt,
      createdAt: at(-back - 30, 10, 0),
    })
    .returning();
  if (!trip) throw new Error("seed: the weather-called Saturday was not written");
  await db.insert(tripDives).values([
    { tripId: trip.id, diveNumber: 1, title: "Molasses Reef", diveSiteId: weatherSiteId },
    { tripId: trip.id, diveNumber: 2, title: "French Reef", diveSiteId: null },
  ]);
  await db.insert(tripRequirements).values({
    tripId: trip.id,
    shopId,
    requiresWaiver: true,
    minimumCertificationLevel: "open_water",
    requiredSpecialties: [] as DiveSpecialty[],
    requiresNitrox: false,
    requiresPayment: false,
  });
  const [blowout] = await db
    .insert(tripBlowouts)
    .values({
      shopId,
      tripId: trip.id,
      calledByPersonId: ctx.ownerId,
      calledAt,
      cause: "weather",
      createdAt: calledAt,
    })
    .returning({ id: tripBlowouts.id });
  if (!blowout) throw new Error("seed: the weather call was not written");

  // From the back of the cohort, so the boats of the last few weeks keep
  // their regulars to themselves; and none who booked again within the month
  // after the call, so "moved to another date" counts the two this story
  // moves and no one else (`weatherCallsInWindow`).
  const rebooked = new Set(
    (
      await db
        .select({ personId: bookings.personId })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, shopId),
            ne(bookings.status, "cancelled"),
            gte(bookings.createdAt, calledAt),
            lt(bookings.createdAt, new Date(calledAt.getTime() + 30 * DAY_MS)),
          ),
        )
    ).map((row) => row.personId),
  );
  const candidates = [...ctx.cohort].reverse().filter((diver) => !rebooked.has(diver.id));
  for (const [seat, lead] of WEATHER_LEAD_DAYS.entries()) {
    const diver = await firstFree(db, shopId, candidates, ctx.used, window);
    if (!diver) break;
    const bookedAt = new Date(window.startsAt.getTime() - lead * DAY_MS - (seat + 1) * 9 * 60_000);
    const refundedAt = new Date(calledAt.getTime() + (seat + 3) * 60_000);
    const [booking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId,
        tripId: trip.id,
        personId: diver.id,
        status: "cancelled",
        createdAt: bookedAt,
      })
      .returning({ id: bookings.id });
    if (!booking) continue;
    await db.insert(bookingPayments).values({
      shopId,
      bookingId: booking.id,
      status: "refunded",
      amountCents: WEATHER_PRICE_CENTS,
      currency: "usd",
      createdAt: bookedAt,
      updatedAt: refundedAt,
    });
    await db.insert(tripBlowoutDivers).values({
      shopId,
      blowoutId: blowout.id,
      bookingId: booking.id,
      personId: diver.id,
      messageStatus: "sent",
      notifiedAt: new Date(calledAt.getTime() + 2 * 60_000),
      createdAt: calledAt,
    });
  }
}

/** The hull the weekend course sails on: the small boat, for the inside reefs. */
const SHOP_CERTIFIED_HULL = "Mantis I";

/**
 * The course's four sessions in the water, two a day, all on the shallow
 * inside reefs a rescue course works from: the exercises at the surface and
 * the self-rescue on Saturday, the unresponsive diver brought up from the
 * bottom and the missing-diver search on Sunday. `day` counts from 0.
 *
 * A Rescue Diver course, not Advanced Open Water: AOW is five adventure dives,
 * one of them a Deep dive past 18 m. The demo cannot establish the actual
 * underwater groups and agency-specific conditions that would permit its
 * students to dive at a Deep-gated site, so it keeps the Rescue story until
 * those facts can be recorded (dive-domain review of the demo reseed, item 4).
 */
const SHOP_CERTIFIED_DIVES: readonly {
  title: string;
  site: string;
  day: number;
  enteredAfterMin: number;
  minutes: number;
  maxDepthMeters: number;
}[] = [
  {
    title: "Self-rescue and the tired diver",
    site: "Pickles Reef",
    day: 0,
    enteredAfterMin: 75,
    minutes: 40,
    maxDepthMeters: 6,
  },
  {
    title: "Panicked and responsive divers at the surface",
    site: "Pickles Reef",
    day: 0,
    enteredAfterMin: 190,
    minutes: 45,
    maxDepthMeters: 5,
  },
  {
    title: "Unresponsive diver brought up from the bottom",
    site: "Christ of the Abyss",
    day: 1,
    enteredAfterMin: 75,
    minutes: 45,
    maxDepthMeters: 7,
  },
  {
    title: "Missing-diver search and the final scenario",
    site: "Christ of the Abyss",
    day: 1,
    enteredAfterMin: 190,
    minutes: 50,
    maxDepthMeters: 8,
  },
];

/**
 * **Two cards the shop issued**: a weekend Rescue Diver course that
 * finished in the last fortnight, both students certified by the instructor
 * on the second afternoon, the way `issueShopCertification` writes it, so
 * their recaps carry the card and Reports counts them as certified here.
 */
async function seedShopCertified(
  db: DbExecutor,
  shopId: string,
  ctx: { cohort: Cohort; used: Set<string>; instructorId: string },
): Promise<void> {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, "Rescue Diver")))
    .limit(1);
  if (!course) return;
  const [hull] = await db
    .select({ id: boats.id })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.name, SHOP_CERTIFIED_HULL)))
    .limit(1);
  if (!hull) return;
  // The latest weekend the instructor and the hull had free, at least a week back.
  let back = 0;
  for (let candidate = 9; candidate <= 40; candidate += 1) {
    const span = { startsAt: at(-candidate, 8, 0), endsAt: at(-candidate + 1, 16, 0) };
    const overlapping = and(
      eq(trips.shopId, shopId),
      liveTrip(),
      lt(trips.startsAt, span.endsAt),
      gt(trips.endsAt, span.startsAt),
    );
    const [clash] = await db
      .select({ id: trips.id })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(and(eq(tripAssignments.personId, ctx.instructorId), overlapping))
      .limit(1);
    const [hullOut] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.boatId, hull.id), overlapping))
      .limit(1);
    if (!clash && !hullOut) {
      back = candidate;
      break;
    }
  }
  if (back === 0) return;
  const days = [
    { startsAt: at(-back, 8, 0), endsAt: at(-back, 16, 0) },
    { startsAt: at(-back + 1, 8, 0), endsAt: at(-back + 1, 16, 0) },
  ];
  const window = { startsAt: days[0]?.startsAt as Date, endsAt: days[1]?.endsAt as Date };
  const siteIds = new Map(
    (
      await db
        .select({ id: diveSites.id, name: diveSites.name })
        .from(diveSites)
        .where(eq(diveSites.shopId, shopId))
    ).map((row) => [row.name, row.id]),
  );
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      courseId: course.id,
      title: SHOP_CERTIFIED_TITLE,
      description:
        "Surface rescues and self-rescue on Saturday; an unresponsive diver and a missing-diver search on Sunday.",
      ...window,
      capacity: 4,
      plannedDives: SHOP_CERTIFIED_DIVES.length,
      priceCents: null,
      boatId: hull.id,
      lensId: (await siteAndLens(db, shopId, SHOP_CERTIFIED_DIVES[0]?.site ?? "", "Learning"))
        .lensId,
      createdAt: at(-back - 40, 10, 0),
    })
    .returning();
  if (!trip) throw new Error("seed: the certified course session was not written");
  await db
    .insert(tripScheduleDays)
    .values(days.map((day, index) => ({ tripId: trip.id, dayNumber: index + 1, ...day })));
  await db.insert(tripDives).values(
    SHOP_CERTIFIED_DIVES.map((dive, index) => ({
      tripId: trip.id,
      diveNumber: index + 1,
      title: dive.title,
      diveSiteId: siteIds.get(dive.site) ?? null,
    })),
  );
  // Every session in the log, with its depth.
  const logged = SHOP_CERTIFIED_DIVES.map((dive, index) => {
    const dayStarts = (days[dive.day] ?? days[0])?.startsAt ?? window.startsAt;
    const enteredAt = new Date(dayStarts.getTime() + dive.enteredAfterMin * 60_000);
    return {
      shopId,
      tripId: trip.id,
      diveNumber: index + 1,
      actualSiteId: siteIds.get(dive.site) ?? null,
      enteredAt,
      exitedAt: new Date(enteredAt.getTime() + dive.minutes * 60_000),
      maxDepthMeters: dive.maxDepthMeters,
      recordedByPersonId: ctx.instructorId,
    };
  });
  await db.insert(executedDives).values(logged);
  await db.insert(tripRequirements).values({
    tripId: trip.id,
    shopId,
    requiresWaiver: true,
    minimumCertificationLevel: course.minimumCertificationLevel ?? "open_water",
    requiredSpecialties: [] as DiveSpecialty[],
    requiresNitrox: false,
    requiresPayment: false,
  });
  await db.insert(tripAssignments).values({
    tripId: trip.id,
    personId: ctx.instructorId,
    tripRole: "instructor",
  });

  const issuedAt = at(-back + 1, 15, 40);
  const seated: string[] = [];
  for (const lead of [16, 9]) {
    const student = await firstFree(
      db,
      shopId,
      ctx.cohort,
      ctx.used,
      window,
      (diver) => diver.level === "advanced_open_water",
    );
    if (!student) break;
    const bookedAt = new Date(window.startsAt.getTime() - lead * DAY_MS);
    const [booking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId,
        tripId: trip.id,
        personId: student.id,
        status: "checked_in",
        createdAt: bookedAt,
      })
      .returning({ id: bookings.id });
    if (!booking) continue;
    seated.push(booking.id);
    // Paid at the desk on the first morning, so the course's money falls in
    // the month it ran, where Reports' "By kind" counts it too.
    const paidAt = new Date(window.startsAt.getTime() - (lead + 20) * 60_000);
    await db.insert(bookingPayments).values({
      shopId,
      bookingId: booking.id,
      status: "paid",
      amountCents: course.priceCents,
      currency: "usd",
      createdAt: paidAt,
      updatedAt: paidAt,
    });
    await db.insert(certifications).values({
      shopId,
      personId: student.id,
      agency: course.agency === "ssi" ? "ssi" : "padi",
      level: "rescue",
      identifier: null,
      status: "verified",
      issuedByShopAt: issuedAt,
      issuedFromTripId: trip.id,
      issuedByPersonId: ctx.instructorId,
      reviewedAt: issuedAt,
      reviewedByPersonId: ctx.instructorId,
      createdAt: issuedAt,
    });
  }

  // The instructor's head count (visual triage of PR #2918, item 1c): both
  // students and herself counted aboard at the dock on the first morning, and
  // back aboard a few minutes after each session's exit. Without it the
  // Safety tab listed a hull that sailed with nobody counted.
  const counts = rollCallCheckpoints(trip.plannedDives).map((checkpoint, index) => ({
    checkpoint,
    occurredAt:
      index === 0
        ? new Date(window.startsAt.getTime() + 20 * 60_000)
        : new Date((logged[index - 1]?.exitedAt ?? window.startsAt).getTime() + 5 * 60_000),
  }));
  if (seated.length > 0) {
    await db.insert(rollCallEvents).values(
      seated.flatMap((bookingId, seat) =>
        counts.map(({ checkpoint, occurredAt }) => ({
          shopId,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: ctx.instructorId,
          status: "boarded" as const,
          checkpoint,
          source: "live" as const,
          occurredAt: new Date(occurredAt.getTime() + seat * 1_000),
        })),
      ),
    );
  }
  await db.insert(rollCallCrewEvents).values(
    counts.map(({ checkpoint, occurredAt }) => ({
      shopId,
      tripId: trip.id,
      personId: ctx.instructorId,
      recordedByPersonId: ctx.instructorId,
      status: "boarded" as const,
      checkpoint,
      source: "live" as const,
      occurredAt: new Date(occurredAt.getTime() + seated.length * 1_000),
    })),
  );
}

/**
 * **The weekly run, full on its next date**: the two divers the weather moved
 * first, then regulars booked through the week, and two more waiting for a
 * seat. Late, after `seedWeeklyRun` has written the run.
 */
export async function fillWeeklyRun(db: DbExecutor, shopId: string): Promise<void> {
  const now = nowDate();
  const [run] = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, DEMO_WEEKLY_RUN_TITLE),
        eq(trips.status, "scheduled"),
        liveTrip(),
        gt(trips.startsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!run) return;
  const cohort = await historyCohort(db, shopId);
  const used = new Set<string>(
    (
      await db
        .select({ personId: bookings.personId })
        .from(bookings)
        .where(and(eq(bookings.tripId, run.id), ne(bookings.status, "cancelled")))
    ).map((row) => row.personId),
  );

  const moved = await db
    .select({
      blowoutDiverId: tripBlowoutDivers.id,
      personId: tripBlowoutDivers.personId,
      calledAt: tripBlowouts.calledAt,
    })
    .from(tripBlowoutDivers)
    .innerJoin(tripBlowouts, eq(tripBlowouts.id, tripBlowoutDivers.blowoutId))
    .innerJoin(trips, eq(trips.id, tripBlowouts.tripId))
    .innerJoin(people, eq(people.id, tripBlowoutDivers.personId))
    .where(and(eq(tripBlowouts.shopId, shopId), eq(trips.title, WEATHER_CALLED_TITLE)))
    .orderBy(asc(people.fullName), asc(tripBlowoutDivers.id));
  if (moved.length > 0) {
    // What the call offered them: the next Saturday.
    await db
      .update(tripBlowoutDivers)
      .set({ offeredTripIds: [run.id] })
      .where(
        inArray(
          tripBlowoutDivers.id,
          moved.map((row) => row.blowoutDiverId),
        ),
      );
  }

  const seat = async (personId: string, bookedAt: Date) => {
    const [booking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId,
        tripId: run.id,
        personId,
        status: "booked",
        createdAt: bookedAt,
      })
      .returning({ id: bookings.id });
    if (!booking) return;
    used.add(personId);
    await db.insert(bookingPayments).values({
      shopId,
      bookingId: booking.id,
      status: "paid",
      amountCents: run.priceCents ?? 0,
      currency: "usd",
      createdAt: bookedAt,
      updatedAt: bookedAt,
    });
  };

  for (const [index, row] of moved.slice(0, WEATHER_MOVED).entries()) {
    if (used.has(row.personId) || (await busy(db, shopId, row.personId, run))) continue;
    await seat(row.personId, new Date(row.calledAt.getTime() + (35 + index * 20) * 60_000));
  }
  const exclude = moved.map((row) => row.personId);
  const pool = cohort.filter((diver) => !exclude.includes(diver.id));
  let open = run.capacity - (await seatsTaken(db, run.id));
  let order = 0;
  while (open > 0) {
    const diver = await firstFree(db, shopId, pool, used, run);
    if (!diver) break;
    // A Saturday sells through the week before it, never ahead of the clock.
    const ahead = Math.max(1, 9 - order * 1.5);
    const bookedAt = new Date(
      Math.min(run.startsAt.getTime() - ahead * DAY_MS, now.getTime() - (order + 1) * 47 * 60_000),
    );
    await seat(diver.id, bookedAt);
    open -= 1;
    order += 1;
  }
  const waiting = [];
  for (let index = 0; index < WEEKLY_RUN_WAITING; index += 1) {
    const diver = await firstFree(db, shopId, pool, used, run);
    if (diver) waiting.push(diver);
  }
  if (waiting.length > 0) {
    await db.insert(interests).values(
      waiting.map((diver, index) => ({
        shopId,
        scope: "departure" as const,
        askedBy: "diver" as const,
        tripId: run.id,
        personId: diver.id,
        // The second is a pair: a diver and the buddy they dive with.
        partySize: index === 1 ? 2 : 1,
        askedAt: new Date(now.getTime() - (20 - index * 14) * 60 * 60_000),
      })),
    );
  }
}
