import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { MIN_PHONE_SEARCH_DIGITS, phoneDigits } from "@/lib/person-fields";
import type { AppDb } from "./client";
import {
  courses,
  diveSites,
  type GearItemStatus,
  gearItems,
  orders,
  people,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The shop-scoped index behind the command palette. Every clause is pinned to
 * one shop, so a bearer of one shop's session can never surface another's
 * people or trips. Capped per group so a broad query stays a quick list, not a
 * dump. Kept to indexed `ilike` on the columns staff actually search by — no
 * new dependency, no full-text engine.
 */

export type DiverHit = { id: string; fullName: string; detail: string | null };
export type TripHit = { id: string; title: string; detail: string };
export type DiveSiteHit = { id: string; name: string };
export type CourseHit = { id: string; slug: string; title: string };
export type OrderHit = { id: string; personName: string; detail: string };
/**
 * A unit of the shop's own gear. `label` is the tag written on it, which the
 * schema says in as many words is "how a wet hand finds the row" — and was the
 * one identifier the shop's search box could not find (issue #719).
 *
 * The **status code**, not its words: this module returns codes and the palette
 * picks the language (`src/i18n/gear-labels.ts`). Carried at all because
 * finding "BCD #14" and learning it is out for service in the same glance is
 * the whole value of the row.
 */
export type GearHit = {
  id: string;
  label: string;
  status: GearItemStatus;
  detail: string | null;
};
export type SearchResults = {
  divers: DiverHit[];
  trips: TripHit[];
  diveSites: DiveSiteHit[];
  courses: CourseHit[];
  orders: OrderHit[];
  gear: GearHit[];
};

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

  // Digits to digits. `people.phone` is free text, so a staffer typing what
  // caller ID showed them never matched a stored `"+1 305 555 0142"`.
  // Deliberately *added* to the raw `ilike` rather than replacing it: the raw
  // comparison is the indexed one this module's docblock is built around, and
  // this expression is not, so the index still carries every name, email and
  // as-typed phone query — only a bare-digits query pays for the scan. Guarded
  // by a digit floor so an ordinary two-letter name query never triggers it.
  const digits = phoneDigits(query);
  const phoneMatch =
    digits.length >= MIN_PHONE_SEARCH_DIGITS
      ? or(
          ilike(people.phone, like),
          sql`regexp_replace(coalesce(${people.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`,
        )
      : ilike(people.phone, like);

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
          or(ilike(people.fullName, like), ilike(people.email, like), phoneMatch),
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
      .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
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
        personName: people.fullName,
        description: orders.description,
        totalCents: orders.totalCents,
        currency: orders.currency,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(people, eq(people.id, orders.personId))
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

  return {
    divers: diverRows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      detail: row.email ?? row.phone ?? null,
    })),
    trips: tripRows.map((row) => {
      const date = formatShortDate(row.startsAt, locale, timeZone);
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
