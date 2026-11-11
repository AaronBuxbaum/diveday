import type { CourseHit, DiveSiteHit, SearchResults } from "../../lib/search-results";

export type {
  CourseHit,
  DiverHit,
  DiveSiteHit,
  GearHit,
  OrderHit,
  SearchResults,
  TripHit,
} from "../../lib/search-results";

import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { GearItemStatus } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import type { AppDb } from "../../db/client";
import { personSearchMatch } from "../../db/person-search";
import { courses, diveSites, gearItems, orders, people, trips } from "../../db/schema/index";
import { tripPrimarySiteId } from "../../db/trip-primary-site";
import { nowDate } from "../../lib/clock";
import { formatDateTimeTz, formatMoneyCents, formatShortDate } from "../../lib/format";
import type { RecentRef } from "../../lib/recent-refs";

const PER_GROUP = 8;
/** One character matches everything; wait for a real query. */
const MIN_QUERY = 2;

/**
 * Every group, empty. Exported because the route hands it back for a session
 * whose shop no longer resolves, and a second hand-written copy there silently
 * lost a group the day one was added (issue #719).
 */
export const EMPTY_RESULTS: SearchResults = {
  divers: [],
  trips: [],
  diveSites: [],
  courses: [],
  orders: [],
  gear: [],
};

export async function searchShop(
  db: AppDb,
  shopId: string,
  rawQuery: string,
  timeZone: string,
  /**
   * The reader's negotiated locale, for the dates and amounts in each result's
   * detail line. Passed in rather than defaulted: this module formats for a
   * person, and a hard-coded default here is invisible from the palette.
   */
  locale: string,
  /**
   * The instant the trips group measures nearness from. Defaulted through the
   * application clock rather than read from the wall clock here, so the e2e
   * fleet's frozen instant reaches the ordering — an ordering that moved with
   * real time would make both the palette's captures and its tests the flaky
   * kind.
   */
  now: Date = nowDate(),
): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY) return EMPTY_RESULTS;
  const like = `%${query}%`;

  // **Nearest to now, in either direction.** `desc(startsAt)` is the right
  // default nearly everywhere else `trips` is read, because those surfaces page
  // a stream forward from now — but `trips` is forward-looking, so in a *search*
  // that idiom spends all eight slots on the furthest-future matches and
  // truncates today's boat out of the results entirely (issue #772). A staffer
  // typing a trip name wants the boat they are working on now, and is as likely
  // to want yesterday's manifest as next week's departure, so the sort key is
  // distance from `now` and past departures stay eligible. It has to be the
  // database's `ORDER BY`, not a re-sort in JavaScript: the `LIMIT` is what
  // truncates, and sorting eight already-wrong rows changes nothing.
  const nearestToNow = sql`abs(extract(epoch from ${trips.startsAt} - ${now}::timestamptz))`;

  const [diverRows, tripRows, diveSiteRows, courseRows, orderRows, gearRows] = await Promise.all([
    db
      .select({
        id: people.id,
        fullName: people.fullName,
        email: people.email,
        phone: people.phone,
      })
      .from(people)
      .where(
        and(
          eq(people.shopId, shopId),
          isNull(people.deletedAt),
          // Name, email and phone through the one shared predicate
          // (`src/db/person-search.ts`), which is where the digits-to-digits
          // phone comparison and its index coupling are argued.
          personSearchMatch(query),
        ),
      )
      .orderBy(people.fullName)
      .limit(PER_GROUP),
    db
      .select({
        id: trips.id,
        title: trips.title,
        startsAt: trips.startsAt,
        siteName: diveSites.name,
      })
      .from(trips)
      .leftJoin(diveSites, eq(diveSites.id, tripPrimarySiteId))
      .where(
        and(
          eq(trips.shopId, shopId),
          liveTrip(),
          or(ilike(trips.title, like), ilike(diveSites.name, like)),
        ),
      )
      // The tie-break: a departure the same distance either side of now reads
      // as the upcoming one first, which is the old idiom kept where it is right.
      .orderBy(nearestToNow, desc(trips.startsAt))
      .limit(PER_GROUP),
    db
      .select({ id: diveSites.id, name: diveSites.name })
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shopId), ilike(diveSites.name, like)))
      .orderBy(diveSites.name)
      .limit(PER_GROUP),
    db
      .select({ id: courses.id, slug: courses.slug, title: courses.title })
      .from(courses)
      .where(and(eq(courses.shopId, shopId), ilike(courses.title, like)))
      .orderBy(courses.title)
      .limit(PER_GROUP),
    db
      .select({
        id: orders.id,
        personName: sql<string>`coalesce(${people.fullName}, nullif(${orders.description}, ''), ${orders.id}::text)`,
        description: orders.description,
        totalCents: orders.totalCents,
        currency: orders.currency,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(people, eq(people.id, orders.personId))
      .where(
        and(
          eq(orders.shopId, shopId),
          or(ilike(people.fullName, like), ilike(orders.description, like)),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(PER_GROUP),
    // The register is opt-in **by presence** (ADR 20260815-minimal-gear-register),
    // so a shop that has never used it simply matches nothing here and the
    // group does not render — no extra "does this shop have gear" query, and no
    // empty heading for the shops that don't.
    db
      .select({
        id: gearItems.id,
        label: gearItems.label,
        status: gearItems.status,
        brandModel: gearItems.brandModel,
        serialNumber: gearItems.serialNumber,
      })
      .from(gearItems)
      .where(
        and(
          eq(gearItems.shopId, shopId),
          isNull(gearItems.deletedAt),
          or(
            ilike(gearItems.label, like),
            ilike(gearItems.serialNumber, like),
            ilike(gearItems.brandModel, like),
          ),
        ),
      )
      .orderBy(gearItems.label)
      .limit(PER_GROUP),
  ]);

  return toResults(
    { diverRows, tripRows, diveSiteRows, courseRows, orderRows, gearRows },
    locale,
    timeZone,
  );
}

type Rows = {
  diverRows: { id: string; fullName: string; email: string | null; phone: string | null }[];
  tripRows: { id: string; title: string; startsAt: Date; siteName: string | null }[];
  diveSiteRows: DiveSiteHit[];
  courseRows: CourseHit[];
  orderRows: {
    id: string;
    personName: string;
    totalCents: number;
    currency: string;
    createdAt: Date;
  }[];
  gearRows: {
    id: string;
    label: string;
    status: GearItemStatus;
    brandModel: string | null;
    serialNumber: string | null;
  }[];
};

function toResults(
  { diverRows, tripRows, diveSiteRows, courseRows, orderRows, gearRows }: Rows,
  locale: string,
  timeZone: string,
): SearchResults {
  return {
    divers: diverRows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      detail: row.email ?? row.phone ?? null,
    })),
    trips: tripRows.map((row) => {
      const date = formatDateTimeTz(row.startsAt, locale, timeZone);
      return {
        id: row.id,
        title: row.title,
        detail: row.siteName ? `${date} · ${row.siteName}` : date,
      };
    }),
    diveSites: diveSiteRows,
    courses: courseRows,
    orders: orderRows.map((row) => ({
      id: row.id,
      personName: row.personName,
      // The order row's own currency, not the shop's current setting — a
      // settled amount is evidence and is never re-denominated.
      detail: `${formatMoneyCents(row.totalCents, row.currency, locale)} · ${formatShortDate(row.createdAt, locale, timeZone)}`,
    })),
    gear: gearRows.map((row) => ({
      id: row.id,
      label: row.label,
      status: row.status,
      // What the unit *is*, beside what it is called — a serial only matters
      // when a recall or a service centre names one, and then it is the whole
      // question, so it wins the line.
      detail: row.serialNumber ?? row.brandModel ?? null,
    })),
  };
}

const idsOf = (refs: readonly RecentRef[], kind: RecentRef["kind"]) =>
  refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);

/**
 * **⌘K's recents, read back live** (security review F2). The browser keeps
 * only `{kind, id}`; the name and detail line come from here each time the
 * palette opens, scoped to the session's shop, so a record removed or erased
 * since is simply not returned and the palette drops it.
 */
export async function resolveRecentRecords(
  db: AppDb,
  shopId: string,
  refs: readonly RecentRef[],
  timeZone: string,
  locale: string,
): Promise<SearchResults> {
  const diverIds = idsOf(refs, "diver");
  const tripIds = idsOf(refs, "trip");
  const orderIds = idsOf(refs, "order");
  const gearIds = idsOf(refs, "gear");
  const none = Promise.resolve([]);
  const [diverRows, tripRows, orderRows, gearRows] = await Promise.all([
    diverIds.length === 0
      ? none
      : db
          .select({
            id: people.id,
            fullName: people.fullName,
            email: people.email,
            phone: people.phone,
          })
          .from(people)
          .where(
            and(eq(people.shopId, shopId), isNull(people.deletedAt), inArray(people.id, diverIds)),
          ),
    tripIds.length === 0
      ? none
      : db
          .select({
            id: trips.id,
            title: trips.title,
            startsAt: trips.startsAt,
            siteName: diveSites.name,
          })
          .from(trips)
          .leftJoin(diveSites, eq(diveSites.id, tripPrimarySiteId))
          .where(and(eq(trips.shopId, shopId), liveTrip(), inArray(trips.id, tripIds))),
    orderIds.length === 0
      ? none
      : db
          .select({
            id: orders.id,
            personName: sql<string>`coalesce(${people.fullName}, nullif(${orders.description}, ''), ${orders.id}::text)`,
            totalCents: orders.totalCents,
            currency: orders.currency,
            createdAt: orders.createdAt,
          })
          .from(orders)
          .leftJoin(people, eq(people.id, orders.personId))
          .where(and(eq(orders.shopId, shopId), inArray(orders.id, orderIds))),
    gearIds.length === 0
      ? none
      : db
          .select({
            id: gearItems.id,
            label: gearItems.label,
            status: gearItems.status,
            brandModel: gearItems.brandModel,
            serialNumber: gearItems.serialNumber,
          })
          .from(gearItems)
          .where(
            and(
              eq(gearItems.shopId, shopId),
              isNull(gearItems.deletedAt),
              inArray(gearItems.id, gearIds),
            ),
          ),
  ]);
  return toResults(
    { diverRows, tripRows, diveSiteRows: [], courseRows: [], orderRows, gearRows },
    locale,
    timeZone,
  );
}
