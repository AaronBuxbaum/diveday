import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { isStaff, type Role } from "@/lib/authz";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  type Notification,
  type NotificationDelivery,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import type { WeeklyDigestEmailSection } from "@/lib/notifications/kinds";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import { shopPath } from "@/lib/staff-notices";
import { countsAsJob, type TodayActionKind } from "@/lib/today";
import {
  type DigestWeeks,
  digestWeeks,
  EMERGENCY_READERS_LISTED,
  EMERGENCY_READS_LISTED,
  isWeeklyDigestDue,
  NO_EMERGENCY_READS,
  NO_LAST_WEEK,
  NO_SAFETY,
  noMoney,
  overdueTodayActions,
  WEEKLY_DIGEST_SECTION_PATHS,
  type WeeklyDigestEmergencyReads,
  type WeeklyDigestFactGrades,
  type WeeklyDigestSection,
  weakestDeparture,
  weeklyDigestGrade,
  weeklyDigestSections,
  weeklyDigestWanted,
} from "@/lib/weekly-digest";
import { inHorizonReadiness } from "./blockers";
import type { AppDb, DbExecutor } from "./client";
import { mondayReadFor } from "./monday-read";
import { sendNotification } from "./notifications";
import { readOwed } from "./owed";
import { queryAll } from "./query-helpers";
import { getMonthlyReport } from "./reporting";
import { readReviewsAwaitingModeration } from "./reviews";
import {
  activityEvents,
  bookings,
  incidentReports,
  interests,
  people,
  personRoles,
  shops,
  tripReviews,
  trips,
  userAccounts,
  weeklyDigestSends,
} from "./schema";
import { getTodayWork } from "./today";
import { tripIdsNeverSentLastMinuteDeal, tripIdsSuitedToADeal } from "./trip-promos";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **The Monday email's reads and its one send path** (market audit item 51).
 *
 * What goes in it is `src/lib/weekly-digest.ts`; the words are
 * `src/lib/notifications/weekly-digest-email.ts`. Every number here comes off
 * a reader another surface already trusts — Reports' month query for last
 * week, the shared readiness horizon for this week and its waivers, Today's
 * queue for what is overdue, the moderation count for reviews — so the email
 * can never tell an owner something the app itself would contradict.
 */

/** The shop row fields the digest reads. */
export type WeeklyDigestShop = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  defaultLocale: string;
  diversPerDivemaster: number;
  /** The shop's one currency: every `*_cents` the money section states is in it. */
  currency: string;
};

export type WeeklyDigestRecipient = {
  personId: string;
  fullName: string;
  email: string;
  locale: string | null;
  roles: Role[];
};

/**
 * Every active staff login at this shop, with their roles and their own
 * answer to the Monday email. Nothing here decides who gets it; that is
 * `weeklyDigestWanted`.
 */
async function staffLogins(
  db: DbExecutor,
  shopId: string,
): Promise<(WeeklyDigestRecipient & { choice: boolean | null })[]> {
  const rows = await db
    .select({
      personId: people.id,
      fullName: people.fullName,
      email: userAccounts.email,
      locale: people.locale,
      choice: userAccounts.weeklyDigest,
      role: personRoles.role,
    })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        eq(userAccounts.status, "active"),
      ),
    );
  const byPerson = new Map<string, WeeklyDigestRecipient & { choice: boolean | null }>();
  for (const row of rows) {
    const existing = byPerson.get(row.personId);
    if (existing) {
      existing.roles.push(row.role as Role);
      continue;
    }
    byPerson.set(row.personId, {
      personId: row.personId,
      fullName: row.fullName,
      email: row.email,
      locale: row.locale,
      choice: row.choice,
      roles: [row.role as Role],
    });
  }
  return [...byPerson.values()].filter((person) => isStaff(person.roles));
}

/** The staff at this shop who get the Monday email. */
export async function listWeeklyDigestRecipients(
  db: DbExecutor,
  shopId: string,
): Promise<WeeklyDigestRecipient[]> {
  return (await staffLogins(db, shopId))
    .filter((person) => weeklyDigestWanted(person.choice, person.roles))
    .map(({ choice: _choice, ...person }) => person);
}

/** Bookings made during `[from, to)`, on departures that still exist. */
async function countBookingsMade(
  db: DbExecutor,
  shopId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bookings)
    .innerJoin(
      trips,
      and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId), liveTrip(), notRehearsal()),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
        gte(bookings.createdAt, from),
        lt(bookings.createdAt, to),
      ),
    );
  return row?.n ?? 0;
}

/** Reviews divers left during `[from, to)`; none for a shop that switched reviews off. */
async function countReviewsReceived(
  db: DbExecutor,
  shopId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tripReviews)
    .innerJoin(shops, eq(shops.id, tripReviews.shopId))
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(shops.reviewsEnabled, true),
        gte(tripReviews.createdAt, from),
        lt(tripReviews.createdAt, to),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Date requests still waiting on a boat: every one not marked done
 * (`handledAt`, the stamp every staff reader of requests filters on; fourth UX
 * review, item 24) that asks for a day from today on, plus the undated ones
 * that came in since last Monday. A named day that has passed is no longer
 * waiting either, and an undated one is news for a week. A shop with date
 * requests switched off counts only its course inquiries.
 */
async function countDateRequestsWaiting(
  db: DbExecutor,
  shopId: string,
  weeks: DigestWeeks,
  today: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(interests)
    .innerJoin(shops, eq(shops.id, interests.shopId))
    .where(
      and(
        eq(interests.shopId, shopId),
        eq(interests.scope, "date"),
        isNull(interests.closedAt),
        // Switched off, the shopfront takes no day asks; a course page's
        // inquiry is not one and still counts (`countWaitingDateInterests`).
        or(eq(shops.dateRequestsEnabled, true), isNotNull(interests.courseId)),
        or(
          sql`greatest(${interests.preferredDate}, ${interests.alternateDate}) >= ${today}`,
          and(
            isNull(interests.preferredDate),
            isNull(interests.alternateDate),
            gte(interests.askedAt, weeks.lastWeek.startUtc),
          ),
        ),
      ),
    );
  return row?.n ?? 0;
}

/** Incident reports filed in the window: the safety line's third fact (item 24). */
async function countIncidentsFiled(
  db: DbExecutor,
  shopId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.shopId, shopId),
        eq(incidentReports.status, "filed"),
        gte(incidentReports.filedAt, from),
        lt(incidentReports.filedAt, to),
      ),
    );
  return row?.n ?? 0;
}

/**
 * **Last week's emergency reads of a medical alert** (issue #2990): every
 * `medical_alert_emergency_read` line on this shop's trails in the window,
 * with the departure it was read for. All of them are counted, in total and
 * per reader (most first); the first {@link EMERGENCY_READS_LISTED} are
 * listed, oldest first (domain review 1, S1; security L2). The three reads
 * share one scope. The names are the trail's own, as they stood when the read
 * was recorded; a blank one is `null` and never fails the email (security
 * L3). Never the words.
 */
async function readEmergencyReads(
  db: DbExecutor,
  shopId: string,
  from: Date,
  to: Date,
): Promise<WeeklyDigestEmergencyReads> {
  const departure = and(
    eq(trips.shopId, activityEvents.shopId),
    sql`${trips.id}::text = ${activityEvents.params}->>'departure'`,
  );
  const readerName = sql<string | null>`max(${activityEvents.params}->>'actor')`;
  const reads = sql<number>`count(*)::int`;
  const [rows, readers] = await queryAll(db, [
    () =>
      db
        .select({
          params: activityEvents.params,
          at: activityEvents.occurredAt,
          departureTitle: trips.title,
          departureStartsAt: trips.startsAt,
        })
        .from(activityEvents)
        // diveday:allow-rehearsal: an emergency read on a rehearsal still opened a real diver's words, and the owner hears of every one.
        .innerJoin(trips, departure)
        .where(
          and(
            eq(activityEvents.shopId, shopId),
            eq(activityEvents.code, "medical_alert_emergency_read"),
            gte(activityEvents.occurredAt, from),
            lt(activityEvents.occurredAt, to),
          ),
        )
        .orderBy(
          activityEvents.occurredAt,
          sql`${activityEvents.params}->>'diver'`,
          activityEvents.id,
        )
        .limit(EMERGENCY_READS_LISTED),
    // The same scope, counted per reader.
    () =>
      db
        .select({ reader: readerName, count: reads })
        .from(activityEvents)
        // diveday:allow-rehearsal: an emergency read on a rehearsal still opened a real diver's words, and the owner hears of every one.
        .innerJoin(trips, departure)
        .where(
          and(
            eq(activityEvents.shopId, shopId),
            eq(activityEvents.code, "medical_alert_emergency_read"),
            gte(activityEvents.occurredAt, from),
            lt(activityEvents.occurredAt, to),
          ),
        )
        .groupBy(activityEvents.actorPersonId)
        .orderBy(desc(reads), readerName)
        .limit(EMERGENCY_READERS_LISTED),
  ]);
  if (readers.length === 0) return NO_EMERGENCY_READS;
  return {
    total: readers.reduce((sum, entry) => sum + entry.count, 0),
    byReader: readers.map((entry) => ({ reader: digestName(entry.reader), count: entry.count })),
    listed: rows.map((row) => {
      const params = (row.params ?? {}) as { actor?: unknown; diver?: unknown };
      return {
        diver: digestName(params.diver),
        reader: digestName(params.actor),
        departureTitle: digestName(row.departureTitle),
        departureStartsAt: row.departureStartsAt,
        at: row.at,
      };
    }),
  };
}

/** A name as the Monday email may carry it: trimmed and at most 200 long, or `null` when blank. */
function digestName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, 200).trim();
  return name === "" ? null : name;
}

/** The Today rows the safety line counts: a roll call still open, a boat with no crew. */
const ROLL_CALL_KINDS: ReadonlySet<TodayActionKind> = new Set<TodayActionKind>([
  "roll_call_missing_diver",
  "roll_call_missing_crew",
  "roll_call_unfinished",
  "roll_call_crew_unfinished",
  "roll_call_departure_open",
  "roll_call_not_started",
]);
const UNCREWED_KINDS: ReadonlySet<TodayActionKind> = new Set<TodayActionKind>([
  "uncrewed_departure",
  "uncrewed_course",
]);

/**
 * Everything the email could say about this shop at `now`, in both grades
 * (`WeeklyDigestFactGrades`): read once per shop, picked per recipient by
 * their live roles.
 */
export async function readWeeklyDigestFacts(
  db: AppDb,
  shop: WeeklyDigestShop,
  now: Date = nowDate(),
): Promise<{ weeks: DigestWeeks; grades: WeeklyDigestFactGrades; preparedAt: string }> {
  const weeks = digestWeeks(now, shop.timezone);

  // Last week and the same week a year before (fifth loop, item 29), read
  // the one way so the two figures cannot be on different bases. 364 days
  // keeps the weekdays aligned: Monday to Monday.
  const yearBefore = (date: Date) => new Date(date.getTime() - 364 * 86_400_000);
  const reportOpts = { timeZone: shop.timezone, currency: shop.currency };
  const [lastWeekReport, yearAgoReport] = await Promise.all([
    getMonthlyReport(db, shop.id, weeks.lastWeek.startUtc, weeks.lastWeek.endUtc, reportOpts),
    getMonthlyReport(
      db,
      shop.id,
      yearBefore(weeks.lastWeek.startUtc),
      yearBefore(weeks.lastWeek.endUtc),
      reportOpts,
    ),
  ]);

  // One readiness pass, shared with Today below so the two cannot disagree.
  const evidence = await inHorizonReadiness(db, shop.id, now);
  const thisWeekTrips = evidence.trips
    .filter((trip) => trip.startsAt.getTime() < weeks.thisWeek.endUtc.getTime())
    // This week's departures have a current booking ceiling, so seat counts
    // and the deal recommendation use the passenger places actually on sale.
    // Last week's report below keeps the capacity recorded for that history.
    .map((trip) => ({ ...trip, capacity: trip.sellableCapacity }));
  const owingDivers = new Set<string>();
  const owingTrips = new Set<string>();
  for (const trip of thisWeekTrips) {
    for (const row of evidence.readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.blockers.some((blocker) => BLOCKER_CATEGORY[blocker.code] === "waiver")) {
        owingDivers.add(row.person.id);
        owingTrips.add(trip.id);
      }
    }
  }

  // Today's queue twice off the one readiness pass: with the owed-refund,
  // stuck-payment and failed-deletion rows Reports' gate holders see, and
  // without them for everyone else — the same split the shop home makes.
  const todayQueue = (includeOpsAlerts: boolean) =>
    getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      now,
      undefined,
      undefined,
      undefined,
      includeOpsAlerts,
      evidence,
      shop.diversPerDivemaster,
      undefined,
      // The email never reads the streamed wind rows; no forecast request.
      false,
    );
  const [reportsToday, staffToday] = await Promise.all([todayQueue(true), todayQueue(false)]);

  const [
    bookingsMade,
    reviewsReceived,
    awaiting,
    dateRequestsWaiting,
    owed,
    incidents,
    emergencyReads,
    neverSentDeal,
    suitedToADeal,
    dealsOffered,
  ] = await Promise.all([
    countBookingsMade(db, shop.id, weeks.lastWeek.startUtc, weeks.lastWeek.endUtc),
    countReviewsReceived(db, shop.id, weeks.lastWeek.startUtc, weeks.lastWeek.endUtc),
    readReviewsAwaitingModeration(db, shop.id),
    countDateRequestsWaiting(db, shop.id, weeks, weeks.weekOf),
    readOwed(db, shop, now),
    countIncidentsFiled(db, shop.id, weeks.lastWeek.startUtc, weeks.lastWeek.endUtc),
    readEmergencyReads(db, shop.id, weeks.lastWeek.startUtc, weeks.lastWeek.endUtc),
    tripIdsNeverSentLastMinuteDeal(
      db,
      shop.id,
      thisWeekTrips.map((trip) => trip.id),
    ),
    tripIdsSuitedToADeal(
      db,
      shop.id,
      thisWeekTrips.map((trip) => trip.id),
    ),
    // A deal is the last-minute list's: switched off, no boat is suggested for one.
    db
      .select({ on: shops.lastMinuteListEnabled })
      .from(shops)
      .where(eq(shops.id, shop.id))
      .then(([row]) => row?.on ?? false),
  ]);
  // Only a scheduled public boat departure is worth a deal (review N7).
  const dealCandidates = new Set(
    dealsOffered ? [...neverSentDeal].filter((id) => suitedToADeal.has(id)) : [],
  );
  // Today's own rows, counted rather than detected twice (item 24).
  const countKinds = (kinds: ReadonlySet<TodayActionKind>) =>
    reportsToday.actions.filter((action) => countsAsJob(action) && kinds.has(action.kind)).length;

  const shared = {
    thisWeek: {
      departures: thisWeekTrips.length,
      seatsFilled: thisWeekTrips.reduce((sum, trip) => sum + trip.booked, 0),
      seats: thisWeekTrips.reduce((sum, trip) => sum + trip.capacity, 0),
      weakest: null,
    },
    waiversOutstanding: { divers: owingDivers.size, departures: owingTrips.size },
    reviews: { received: reviewsReceived, awaitingModeration: awaiting.count },
    dateRequestsWaiting,
  };
  return {
    weeks,
    preparedAt: now.toISOString(),
    grades: {
      reports: {
        ...shared,
        // The boat worth a deal is a money call, so it is the Reports grade's.
        thisWeek: {
          ...shared.thisWeek,
          weakest: weakestDeparture(thisWeekTrips, dealCandidates, now),
        },
        lastWeek: {
          bookingsMade,
          departures: lastWeekReport.trips.length,
          seatsFilled: lastWeekReport.trips.reduce((sum, trip) => sum + trip.activeBookings, 0),
          seats: lastWeekReport.trips.reduce((sum, trip) => sum + trip.capacity, 0),
        },
        overdueTodayItems: overdueTodayActions(reportsToday.actions, now),
        // Reports' own figures for last week's departures, so the email and
        // the Reports page cannot disagree about what the week took.
        money: {
          revenueCents: lastWeekReport.revenueCents,
          // Quiet until the shop sailed that week a year ago.
          lastYearRevenueCents: yearAgoReport.trips.length > 0 ? yearAgoReport.revenueCents : null,
          tipsCents: lastWeekReport.tipsCents,
          owed: {
            orderCents: owed.orders.cents,
            orderCount: owed.orders.count,
            seatCents: owed.seats.cents,
            seatCount: owed.seats.count,
          },
          currency: shop.currency,
        },
        gearServiceDue: countKinds(new Set<TodayActionKind>(["gear_service_due"])),
        safety: {
          openRollCalls: countKinds(ROLL_CALL_KINDS),
          uncrewed: countKinds(UNCREWED_KINDS),
          incidents,
        },
        // The owner and managers read the diver's trail anyway (issue #2990).
        emergencyReads,
      },
      staff: {
        ...shared,
        lastWeek: NO_LAST_WEEK,
        overdueTodayItems: overdueTodayActions(staffToday.actions, now),
        money: noMoney(shop.currency),
        gearServiceDue: 0,
        safety: NO_SAFETY,
        emergencyReads: NO_EMERGENCY_READS,
      },
    },
  };
}

/**
 * The sections the `monday` assist may write about: all but the emergency
 * reads (issue #2990), which carry names and no count, and which the owner
 * reads line by line rather than as a sentence written about them.
 */
function forTheRead(sections: WeeklyDigestEmailSection[]): WeeklyDigestEmailSection[] {
  return sections.filter((section) => section.kind !== "emergency_reads");
}

/** Each grade's sections, linked once per shop rather than once per recipient. */
function linkedGrades(
  grades: WeeklyDigestFactGrades,
  origin: string,
  shopSlug: string,
): { reports: WeeklyDigestEmailSection[]; staff: WeeklyDigestEmailSection[] } {
  return {
    reports: digestSectionsWithLinks(weeklyDigestSections(grades.reports), origin, shopSlug),
    staff: digestSectionsWithLinks(weeklyDigestSections(grades.staff), origin, shopSlug),
  };
}

/** Each section with the staff page it opens, as an absolute URL. */
export function digestSectionsWithLinks(
  sections: readonly WeeklyDigestSection[],
  origin: string,
  shopSlug: string,
): WeeklyDigestEmailSection[] {
  return sections.map((section) => {
    const url = `${origin}${shopPath(shopSlug, ...WEEKLY_DIGEST_SECTION_PATHS[section.kind])}`;
    if (section.kind !== "this_week") return { ...section, url };
    const { weakest, ...rest } = section;
    return {
      ...rest,
      url,
      // The trip's own deal form, as Today's open-seats row links it.
      weakest: weakest && {
        title: weakest.title,
        startsAt: weakest.startsAt,
        booked: weakest.booked,
        capacity: weakest.capacity,
        url: `${origin}${shopPath(shopSlug, "trips", weakest.tripId)}?view=details#last-minute-deal`,
      },
    };
  });
}

/** Where a staffer changes their own answer. */
export function weeklyDigestSettingsPath(shopSlug: string): string {
  return shopPath(shopSlug, "settings", "email");
}

function digestNotification(input: {
  shop: WeeklyDigestShop;
  recipient: WeeklyDigestRecipient;
  weeks: DigestWeeks;
  sections: WeeklyDigestEmailSection[];
  preparedAt: string;
  read?: { section: string; text: string }[];
  origin: string;
  turnOffUrl: string;
}): Notification {
  const { shop, recipient, weeks } = input;
  return {
    kind: "weekly_digest",
    preparedAt: input.preparedAt,
    shopId: shop.id,
    personId: recipient.personId,
    to: recipient.email,
    locale: recipientLocale(recipient.locale, shop.defaultLocale),
    recipientName: recipient.fullName,
    shopName: shop.name,
    timezone: shop.timezone,
    weekOf: weeks.weekOf,
    lastWeekFrom: weeks.lastWeek.from,
    lastWeekTo: weeks.lastWeek.to,
    thisWeekFrom: weeks.thisWeek.from,
    thisWeekTo: weeks.thisWeek.to,
    sections: input.sections,
    ...(input.read && input.read.length > 0 ? { read: input.read } : {}),
    settingsUrl: `${input.origin}${weeklyDigestSettingsPath(shop.slug)}`,
    turnOffUrl: input.turnOffUrl,
  };
}

/**
 * The email this staffer would get this week, for the preview on their own
 * settings page — or null for a week the pass would not send. Built exactly as
 * the send builds it, except that its "stop these" link is their settings page:
 * a preview mints no token and writes nothing.
 */
export async function previewWeeklyDigest(
  db: AppDb,
  input: {
    shop: WeeklyDigestShop;
    personId: string;
    origin: string;
    now?: Date;
  },
): Promise<Notification | null> {
  const recipient = (await staffLogins(db, input.shop.id)).find(
    (person) => person.personId === input.personId,
  );
  if (!recipient) return null;
  const { weeks, grades, preparedAt } = await readWeeklyDigestFacts(
    db,
    input.shop,
    input.now ?? nowDate(),
  );
  const grade = weeklyDigestGrade(recipient.roles);
  const sections = linkedGrades(grades, input.origin, input.shop.slug)[grade];
  if (sections.length === 0) return null;
  const read = await mondayReadFor(db, {
    shopId: input.shop.id,
    weekOf: weeks.weekOf,
    grade,
    locale: recipientLocale(recipient.locale, input.shop.defaultLocale),
    sections: forTheRead(sections),
  });
  return digestNotification({
    shop: input.shop,
    recipient,
    weeks,
    preparedAt,
    sections,
    read,
    origin: input.origin,
    turnOffUrl: `${input.origin}${weeklyDigestSettingsPath(input.shop.slug)}`,
  });
}

export type WeeklyDigestShopSummary = {
  /** Emails handed to the provider and accepted. */
  sent: number;
  /** Recipients already claimed for this week by an earlier pass. */
  alreadySent: number;
  /** Claimed this pass but not accepted (`failed` or `not_configured`). */
  failed: number;
  /** True when the shop had nothing to say this week. */
  quiet: boolean;
};

/**
 * This shop's Monday email to everyone who gets it, once per person per week.
 *
 * The claim is the insert: a `weekly_digest_sends` row for `(person, week)`
 * goes in before the send, and only the pass whose insert landed sends. A
 * retryable failure is carried by the generic send queue under the kind's
 * own key; a crash between claim and send costs that person one week's email,
 * which is the right side to fail on for a summary (never twice, sometimes not
 * at all).
 */
export async function sendWeeklyDigestForShop(
  db: AppDb,
  shop: WeeklyDigestShop,
  options: { now?: Date; origin: string; provider?: NotificationProvider },
): Promise<WeeklyDigestShopSummary> {
  const now = options.now ?? nowDate();
  const summary: WeeklyDigestShopSummary = { sent: 0, alreadySent: 0, failed: 0, quiet: false };
  const recipients = await listWeeklyDigestRecipients(db, shop.id);
  if (recipients.length === 0) return summary;

  const weekOf = digestWeeks(now, shop.timezone).weekOf;
  const claimed = new Set(
    (
      await db
        .select({ personId: weeklyDigestSends.personId })
        .from(weeklyDigestSends)
        .where(
          and(
            eq(weeklyDigestSends.shopId, shop.id),
            eq(weeklyDigestSends.weekOf, weekOf),
            inArray(
              weeklyDigestSends.personId,
              recipients.map((recipient) => recipient.personId),
            ),
          ),
        )
    ).map((row) => row.personId),
  );
  const pending = recipients.filter((recipient) => !claimed.has(recipient.personId));
  summary.alreadySent = recipients.length - pending.length;
  // Every hour after the first on a Monday lands here and stops: the facts
  // are the expensive half, and nobody is left to send them to.
  if (pending.length === 0) return summary;

  const { weeks, grades, preparedAt } = await readWeeklyDigestFacts(db, shop, now);
  const linked = linkedGrades(grades, options.origin, shop.slug);
  if (linked.reports.length === 0 && linked.staff.length === 0) {
    summary.quiet = true;
    return summary;
  }

  // The opening sentences, one ask per grade and language this pass, however
  // many recipients share them (`mondayReadFor` keeps them for the week).
  const reads = new Map<string, Promise<{ section: string; text: string }[]>>();
  const readFor = (grade: keyof typeof linked, locale: string) => {
    const key = `${grade}:${locale}`;
    let read = reads.get(key);
    if (!read) {
      read = mondayReadFor(db, {
        shopId: shop.id,
        weekOf: weeks.weekOf,
        grade,
        locale,
        sections: forTheRead(linked[grade]),
      });
      reads.set(key, read);
    }
    return read;
  };

  for (const recipient of pending) {
    const grade = weeklyDigestGrade(recipient.roles);
    const sections = linked[grade];
    // Nothing this person may read happened: no email, and no claim, so a
    // later pass the same morning asks again rather than remembering a send.
    if (sections.length === 0) continue;
    const token = createBearerToken();
    const [claim] = await db
      .insert(weeklyDigestSends)
      .values({
        shopId: shop.id,
        personId: recipient.personId,
        weekOf: weeks.weekOf,
        unsubscribeTokenHash: hashBearerToken(token),
      })
      .onConflictDoNothing()
      .returning({ id: weeklyDigestSends.id });
    if (!claim) {
      summary.alreadySent += 1;
      continue;
    }
    const delivery: NotificationDelivery = await sendNotification(
      db,
      digestNotification({
        shop,
        recipient,
        weeks,
        preparedAt,
        sections,
        read: await readFor(grade, recipientLocale(recipient.locale, shop.defaultLocale)),
        origin: options.origin,
        turnOffUrl: `${options.origin}/unsubscribe/${token}`,
      }),
      options.provider,
    );
    await db
      .update(weeklyDigestSends)
      .set({ status: delivery.status })
      .where(eq(weeklyDigestSends.id, claim.id));
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }
  return summary;
}

export type WeeklyDigestPassSummary = {
  /** Shops whose Monday morning it is. */
  shopsDue: number;
  sent: number;
  alreadySent: number;
  failed: number;
  quietShops: number;
  /** Shops whose pass threw; logged and skipped so one shop cannot stop the rest. */
  shopErrors: number;
};

/**
 * The hourly pass: every real shop whose own calendar says it is Monday
 * morning. Demo shops never send — the canonical demo and every minted one
 * carry `is_demo`, and their staff are seeded addresses — but their staff can
 * still open the preview.
 */
export async function sendDueWeeklyDigests(
  db: AppDb,
  options: { now?: Date; provider?: NotificationProvider; origin?: string | null } = {},
): Promise<WeeklyDigestPassSummary> {
  const now = options.now ?? nowDate();
  const summary: WeeklyDigestPassSummary = {
    shopsDue: 0,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    quietShops: 0,
    shopErrors: 0,
  };
  const origin = options.origin === undefined ? publicAppUrl() : options.origin;
  if (!origin) {
    log("weekly_digest.no_origin", "error", {});
    return summary;
  }
  const candidates = await db
    .select({
      id: shops.id,
      slug: shops.slug,
      name: shops.name,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
      diversPerDivemaster: shops.diversPerDivemaster,
      currency: shops.currency,
    })
    .from(shops)
    .where(eq(shops.isDemo, false));

  for (const shop of candidates) {
    if (!isWeeklyDigestDue(now, shop.timezone)) continue;
    summary.shopsDue += 1;
    try {
      const result = await sendWeeklyDigestForShop(db, shop, {
        now,
        origin,
        provider: options.provider,
      });
      summary.sent += result.sent;
      summary.alreadySent += result.alreadySent;
      summary.failed += result.failed;
      if (result.quiet) summary.quietShops += 1;
    } catch (error) {
      summary.shopErrors += 1;
      log("weekly_digest.shop_failed", "error", {
        shopId: shop.id,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  return summary;
}

/** This staffer's answer and what it resolves to, for their settings page. */
export async function readWeeklyDigestChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<{ wanted: boolean; isDefault: boolean } | null> {
  const person = (await staffLogins(db, input.shopId)).find(
    (login) => login.personId === input.personId,
  );
  if (!person) return null;
  return {
    wanted: weeklyDigestWanted(person.choice, person.roles),
    isDefault: person.choice === null,
  };
}

/** Records this staffer's own answer. Only ever their own row: the caller passes the session. */
export async function setWeeklyDigestChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string; wanted: boolean },
): Promise<boolean> {
  const updated = await db
    .update(userAccounts)
    .set({ weeklyDigest: input.wanted })
    .where(
      and(
        eq(userAccounts.personId, input.personId),
        sql`exists (select 1 from ${people} where ${people.id} = ${userAccounts.personId} and ${people.shopId} = ${input.shopId})`,
      ),
    )
    .returning({ id: userAccounts.id });
  return updated.length > 0;
}

export type WeeklyDigestUnsubscribeContext = {
  shopName: string;
  personId: string;
  alreadyOff: boolean;
};

/**
 * Resolves an opt-out link from a Monday email to the person it was sent to,
 * or null for anything that must read as "this link isn't available". An
 * already-off person resolves, so a second click says so rather than failing.
 */
export async function resolveWeeklyDigestUnsubscribeToken(
  db: DbExecutor,
  token: string,
): Promise<WeeklyDigestUnsubscribeContext | null> {
  const [row] = await db
    .select({
      claimShopId: weeklyDigestSends.shopId,
      personShopId: people.shopId,
      personId: people.id,
      shopName: shops.name,
      choice: userAccounts.weeklyDigest,
    })
    .from(weeklyDigestSends)
    .innerJoin(people, eq(people.id, weeklyDigestSends.personId))
    .innerJoin(shops, eq(shops.id, people.shopId))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(weeklyDigestSends.unsubscribeTokenHash, hashBearerToken(token)),
        // A deleted person's link is not available: the account it would turn
        // off belongs to nobody the shop still has.
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!row || row.claimShopId !== row.personShopId) return null;
  return { shopName: row.shopName, personId: row.personId, alreadyOff: row.choice === false };
}

/** The one-click opt-out: idempotent, and it only ever turns the email off. */
export async function turnOffWeeklyDigestByToken(
  db: DbExecutor,
  input: { token: string },
): Promise<WeeklyDigestUnsubscribeContext | null> {
  const context = await resolveWeeklyDigestUnsubscribeToken(db, input.token);
  if (!context) return null;
  await db
    .update(userAccounts)
    .set({ weeklyDigest: false })
    .where(eq(userAccounts.personId, context.personId));
  return context;
}
