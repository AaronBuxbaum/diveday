import { and, asc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { ActivityEntry } from "@/lib/activity";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  activityCodesOfKind,
  type ShopActivityKind,
  type ShopActivitySource,
} from "@/lib/shop-activity";
import { isUuid } from "@/lib/uuid";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import {
  activityEvents,
  bookings,
  orders,
  people,
  personRoles,
  reviewModerationEvents,
  tripChangeEvents,
  trips,
} from "./schema";

/**
 * **The shop's activity log** (D5): who refunded, who wrote a seat past a
 * missing card, who moved a departure — one owner-facing read over the
 * append-only trails the product already keeps, plus the few writes that
 * named nobody until it asked.
 *
 * ## One read model, three trails
 *
 * - `activity_events` — the operational trail: seats, crew, notes, exports,
 *   participant-type changes (and the card checks they cleared or overrode),
 *   and now refunds and the schedule builder's acts ({@link recordShopActivity}).
 * - `review_moderation_events` — who published or hid a review.
 * - `trip_change_events` — who moved a meeting point or posted conditions;
 *   only rows a person wrote (`actor_person_id` set), since a line about
 *   "someone" answers nothing.
 *
 * ## Erasure
 *
 * Nothing here stores a name it did not already store, and nothing reads a
 * name the erasure path does not already reach:
 *
 * - an `activity_events` line keeps its names in `params`, which
 *   `anonymizeDiver` rewrites to `ACTIVITY_REDACTED` under exactly the
 *   predicate the diver record reads (booking, actor, subject). Every line
 *   {@link recordShopActivity} writes with a diver's name carries that diver's
 *   `booking_id`, so the sweep finds it by construction; the one that carries
 *   no name (`order_refunded`) carries the customer as `subject_person_id`
 *   for the same reason.
 * - every other name on a line — the actor's, joined for the other two trails
 *   — is `people.full_name` read live, which erasure overwrites in place.
 * - a review line names no reviewer, and a plan-change line no diver.
 *
 * ## Retention
 *
 * The log shows what the trails still hold; it keeps nothing. An
 * `activity_events` line leaves it the night `RETENTION_DAYS` prunes it
 * (`src/lib/retention.ts`); a moderation or plan-change row lives as long as
 * its review or departure does, and so does its line here.
 */

/** One line of the log, as the reader returns it: codes, ids and names. */
export type ShopActivityLine = {
  /** Unique across the three trails: the source prefixes the row id. */
  key: string;
  source: ShopActivitySource;
  /** An `activity_events` code, a moderation action, or a plan-change kind. */
  code: string;
  /** The names an `activity_events` sentence needs; empty for the other two. */
  params: unknown;
  actorPersonId: string | null;
  /** The actor's name as the people row holds it today; null when unknown. */
  actorName: string | null;
  tripId: string | null;
  /** The departure's title, when the line has one. */
  tripTitle: string | null;
  /** Whether that departure is still on the board — a deleted one has no page. */
  tripLive: boolean;
  orderId: string | null;
  /** The person a record-scoped line is about (a note on their record). */
  subjectPersonId: string | null;
  occurredAt: Date;
};

export type ShopActivityFilter = {
  /** Lines this person did. */
  actorPersonId?: string;
  kind?: ShopActivityKind;
  /** Inclusive lower bound. */
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
};

/** How many lines a page of the log shows: the list is the page. */
export const SHOP_ACTIVITY_PAGE_SIZE = PAGE_SIZE.list;

type LineRow = {
  source: ShopActivitySource;
  id: string;
  code: string;
  params: unknown;
  actor_person_id: string | null;
  trip_id: string | null;
  order_id: string | null;
  subject_person_id: string | null;
  occurred_at: Date | string;
  seq: number | string;
};

/**
 * The union of the three trails under one filter, as a SQL fragment both the
 * page and its count read — so the pager's total is the row query's exact
 * scope (ADR 20260803-one-pagination-model).
 *
 * A source the kind filter rules out is dropped from the union entirely
 * rather than filtered to nothing, and the `activity_events` arm narrows by
 * the kind's own code list.
 */
function linesUnion(shopId: string, filter: ShopActivityFilter): SQL | null {
  const kind = filter.kind;
  const arms: SQL[] = [];
  const bounds = (column: SQL) => {
    const parts: SQL[] = [];
    if (filter.from) parts.push(sql` and ${column} >= ${filter.from.toISOString()}`);
    if (filter.to) parts.push(sql` and ${column} < ${filter.to.toISOString()}`);
    return sql.join(parts, sql``);
  };
  const actor = (column: SQL) =>
    filter.actorPersonId ? sql` and ${column} = ${filter.actorPersonId}` : sql``;

  if (kind !== "reviews") {
    const codes = kind ? activityCodesOfKind(kind) : null;
    const codeFilter =
      codes && codes.length > 0
        ? sql` and ae.code in (${sql.join(
            codes.map((code) => sql`${code}`),
            sql`, `,
          )})`
        : sql``;
    arms.push(sql`
      select 'activity' as source, ae.id::text as id, ae.code as code, ae.params as params,
        ae.actor_person_id::text as actor_person_id, ae.trip_id::text as trip_id,
        ae.order_id::text as order_id, ae.subject_person_id::text as subject_person_id,
        ae.occurred_at as occurred_at, ae.seq as seq
      from ${activityEvents} ae
      where ae.shop_id = ${shopId}${codeFilter}${actor(sql`ae.actor_person_id`)}${bounds(
        sql`ae.occurred_at`,
      )}`);
  }
  if (!kind || kind === "reviews") {
    arms.push(sql`
      select 'review' as source, rme.id::text as id, rme.action::text as code,
        '{}'::jsonb as params, rme.recorded_by_person_id::text as actor_person_id,
        null::text as trip_id, null::text as order_id, null::text as subject_person_id,
        rme.occurred_at as occurred_at, 0::bigint as seq
      from ${reviewModerationEvents} rme
      where rme.shop_id = ${shopId}${actor(sql`rme.recorded_by_person_id`)}${bounds(
        sql`rme.occurred_at`,
      )}`);
  }
  if (!kind || kind === "departures") {
    arms.push(sql`
      select 'trip_change' as source, tce.id::text as id, tce.kind::text as code,
        '{}'::jsonb as params, tce.actor_person_id::text as actor_person_id,
        tce.trip_id::text as trip_id, null::text as order_id, null::text as subject_person_id,
        tce.occurred_at as occurred_at, tce.seq as seq
      from ${tripChangeEvents} tce
      where tce.shop_id = ${shopId} and tce.actor_person_id is not null${actor(
        sql`tce.actor_person_id`,
      )}${bounds(sql`tce.occurred_at`)}`);
  }
  if (arms.length === 0) return null;
  return sql.join(arms, sql` union all `);
}

/**
 * One page of the shop's log, newest first.
 *
 * Tenancy is the caller's `shopId` on every arm of the union and on every
 * name and title joined after it: an actor id, trip id or order id that
 * belongs to another shop resolves to nothing rather than to that shop's row.
 * A malformed person id is not a filter that matches nothing but a query that
 * would raise, so it selects nothing instead (`isUuid`).
 */
export async function pagedShopActivity(
  db: AppDb,
  shopId: string,
  filter: ShopActivityFilter = {},
  options: { page?: number; pageSize?: number } = {},
) {
  const usable =
    isUuid(shopId) && (filter.actorPersonId === undefined || isUuid(filter.actorPersonId));
  const union = usable ? linesUnion(shopId, filter) : null;
  const page = await offsetPage<LineRow>({
    page: options.page,
    pageSize: options.pageSize ?? SHOP_ACTIVITY_PAGE_SIZE,
    countRows: async () => {
      if (!union) return 0;
      const result = await db.execute(sql`select count(*)::int as total from (${union}) lines`);
      return Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0);
    },
    fetchRows: async (offset, limit) => {
      if (!union) return [];
      // Newest first; within one instant the trail's own `seq` decides, and
      // the source name keeps two trails' ties in a stable order.
      const result = await db.execute(
        sql`select * from (${union}) lines
          order by occurred_at desc, source asc, seq desc, id asc
          limit ${limit} offset ${offset}`,
      );
      return result.rows as LineRow[];
    },
  });

  const actorIds = unique(page.rows.map((row) => row.actor_person_id));
  const tripIds = unique(page.rows.map((row) => row.trip_id));
  const [actors, tripRows] = await Promise.all([
    actorIds.length > 0
      ? db
          .select({ id: people.id, name: people.fullName })
          .from(people)
          .where(and(eq(people.shopId, shopId), inArray(people.id, actorIds)))
      : Promise.resolve([]),
    tripIds.length > 0
      ? db
          .select({ id: trips.id, title: trips.title, deletedAt: trips.deletedAt })
          .from(trips)
          // diveday:allow-deleted-trips: the log keeps naming a departure after
          // it is deleted ("Ana deleted the departure"), and says it has no page.
          .where(and(eq(trips.shopId, shopId), inArray(trips.id, tripIds)))
      : Promise.resolve([]),
  ]);
  const actorName = new Map(actors.map((actor) => [actor.id, actor.name]));
  const trip = new Map(tripRows.map((row) => [row.id, row]));

  return {
    ...page,
    rows: page.rows.map((row): ShopActivityLine => {
      const tripRow = row.trip_id ? trip.get(row.trip_id) : undefined;
      return {
        key: `${row.source}:${row.id}`,
        source: row.source,
        code: row.code,
        params: row.params,
        actorPersonId: row.actor_person_id,
        actorName: row.actor_person_id ? (actorName.get(row.actor_person_id) ?? null) : null,
        tripId: tripRow ? tripRow.id : null,
        tripTitle: tripRow?.title ?? null,
        tripLive: tripRow ? tripRow.deletedAt === null : false,
        orderId: row.order_id,
        subjectPersonId: row.subject_person_id,
        occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
      };
    }),
  };
}

function unique(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

/**
 * The people the log's "Who" filter offers: everyone in the shop holding a
 * staff role, name-sorted. A diver who claimed their own seat is an actor in
 * the trail too, but the filter is the owner's question about their team.
 */
export async function listShopActivityPeople(db: AppDb, shopId: string) {
  if (!isUuid(shopId)) return [];
  const rows = await db
    .selectDistinct({ id: people.id, name: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id));
  return rows;
}

/**
 * The acts that named nobody until the log asked, and the one object each is
 * about. The names the sentence needs are looked up here, inside the shop, so
 * a caller cannot file a line about another tenant's seat or departure.
 */
export type ShopActivityWrite =
  | { code: "order_refunded"; orderId: string }
  | {
      code: "seat_refunded" | "payment_waived" | "payment_marked_refunded";
      bookingId: string;
    }
  | {
      code:
        | "departure_added"
        | "series_added"
        | "departure_moved"
        | "departure_copied"
        | "departure_deleted";
      tripId: string;
    };

/**
 * Write one of {@link ShopActivityWrite}'s lines. Returns whether it was
 * written: an id that is not this shop's — or an actor who is not — writes
 * nothing, and the act it describes has already happened either way, so a
 * caller never fails the act over its line.
 *
 * Every line naming a diver carries that diver's `booking_id`, which is the
 * handle `anonymizeDiver` redacts it by.
 */
export async function recordShopActivity(
  db: DbExecutor,
  input: { shopId: string; actorPersonId: string; write: ShopActivityWrite },
): Promise<boolean> {
  try {
    return await writeShopActivity(db, input);
  } catch (error) {
    // The act already happened (a refund may have moved money): a failed
    // line is logged, never surfaced as a failed act. Codes and ids only.
    log("shop_activity.write_failed", "error", {
      shopId: input.shopId,
      code: input.write.code,
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

async function writeShopActivity(
  db: DbExecutor,
  input: { shopId: string; actorPersonId: string; write: ShopActivityWrite },
): Promise<boolean> {
  const { shopId, actorPersonId, write } = input;
  if (!isUuid(shopId) || !isUuid(actorPersonId)) return false;
  const [actor] = await db
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, actorPersonId), eq(people.shopId, shopId)))
    .limit(1);
  if (!actor) return false;

  let values: {
    tripId: string | null;
    bookingId: string | null;
    orderId: string | null;
    subjectPersonId: string | null;
    entry: ActivityEntry;
  } | null = null;

  if (write.code === "order_refunded") {
    if (!isUuid(write.orderId)) return false;
    const [order] = await db
      .select({ id: orders.id, personId: orders.personId })
      .from(orders)
      .where(and(eq(orders.id, write.orderId), eq(orders.shopId, shopId)))
      .limit(1);
    if (!order) return false;
    values = {
      tripId: null,
      bookingId: null,
      orderId: order.id,
      subjectPersonId: order.personId,
      entry: { code: write.code, params: { actor: actor.name } },
    };
  } else if ("bookingId" in write) {
    if (!isUuid(write.bookingId)) return false;
    const [seat] = await db
      .select({ id: bookings.id, tripId: bookings.tripId, diver: people.fullName })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.id, write.bookingId), eq(bookings.shopId, shopId)))
      .limit(1);
    if (!seat) return false;
    values = {
      tripId: seat.tripId,
      bookingId: seat.id,
      orderId: null,
      subjectPersonId: null,
      entry: { code: write.code, params: { actor: actor.name, diver: seat.diver } },
    };
  } else {
    if (!isUuid(write.tripId)) return false;
    const [departure] = await db
      .select({ id: trips.id })
      .from(trips)
      // diveday:allow-deleted-trips: `departure_deleted` is written after the
      // delete it records, so the row it names is already off the board.
      .where(and(eq(trips.id, write.tripId), eq(trips.shopId, shopId)))
      .limit(1);
    if (!departure) return false;
    values = {
      tripId: departure.id,
      bookingId: null,
      orderId: null,
      subjectPersonId: null,
      entry: { code: write.code, params: { actor: actor.name } },
    };
  }

  await db.insert(activityEvents).values({
    shopId,
    tripId: values.tripId,
    bookingId: values.bookingId,
    orderId: values.orderId,
    subjectPersonId: values.subjectPersonId,
    actorPersonId,
    code: values.entry.code,
    params: values.entry.params,
    occurredAt: nowDate(),
  });
  return true;
}
