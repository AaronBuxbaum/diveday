import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { courses, shops } from "./schema";

/**
 * **Deleting a person probes every foreign key that names people**, and a
 * column with no index leading on it is probed by scanning the whole table,
 * every shop's rows. People are hard-deleted in two places: a demo shop's
 * cascade (`deleteDemoShopCascade`, nightly and inside "Try the live demo" at
 * the 200-demo cap) and `discardUnusedBuyer` on a refused public checkout.
 * Erasure anonymizes rather than deletes, so it never reaches this.
 *
 * Fourth review, row 31, counted 120 of the 134 single-column people foreign
 * keys without a leading index (a `(shop_id, person_id)` composite serves a
 * shop's own reads, not that probe). Indexing all of them taxes every write
 * for a delete that happens to demo data, so the rule is narrower:
 *
 * - {@link MUST_LEAD} are the tables that grow with every shop's activity, and
 *   each keeps an index leading on its person column. Removing one fails here.
 * - {@link UNINDEXED_CEILING} is a ratchet on the rest: a new people foreign
 *   key arrives with its index, or this number goes up in review with a reason.
 */
const MUST_LEAD = [
  "activity_events.actor_person_id",
  "activity_events.subject_person_id",
  "bookings.person_id",
  "certifications.person_id",
  "executed_dives.recorded_by_person_id",
  "inbound_messages.person_id",
  "orders.person_id",
  "roll_call_crew_events.person_id",
  "roll_call_events.recorded_by_person_id",
  "staff_replies.person_id",
  "trip_change_events.actor_person_id",
  "today_read_marks.person_id",
  "trip_desk_events.actor_person_id",
  "trip_desk_events.subject_person_id",
  "trip_help_requests.helper_person_id",
  "waiver_records.person_id",
];

// 108 since batch 6 (#2597): `booking_payments.recorded_by_person_id` and
// `booking_payment_events.recorded_by_person_id` attribute a staffer's manual
// Paid mark. Written once per mark, read by nothing that probes by person, so
// an index would tax every payment write for a demo-data delete.
// 109: `incident_reports.deleted_by_person_id` names who discarded a draft on
// the departure log. Set once per discard on a table of a few rows a year, and
// read by report, never by person.
// 110: `gear_reservations.fill_recorded_by_person_id` (#2257) names who
// recorded a counter tank's fill. Written once per fill and read with the
// reservation, never probed by person.
// 111-112 with #2275: `bookings.training_marked_by_person_id` and
// `bookings.training_cleared_by_person_id` attribute a staffer's training
// mark, for the same reason.
// 113 (fifth loop, desk layer): `inbox_saved_answers.source_person_id` names
// whose reply a saved answer came from. A shop keeps a handful, and erasure
// reads them by `(shop_id, source_person_id)`, which its composite serves.
const UNINDEXED_CEILING = 113;

async function unindexedPeopleForeignKeys(db: AppDb): Promise<string[]> {
  const result = await db.execute(sql`
    select c.conrelid::regclass::text || '.' || a.attname as column
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'people'::regclass
       and array_length(c.conkey, 1) = 1
       and not exists (
         select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
       )
     order by 1
  `);
  const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
  return (rows as { column: string }[]).map((row) => row.column);
}

describe("foreign keys to people", () => {
  it("keep an index leading on the person column of every high-volume table", async () => {
    const unindexed = await unindexedPeopleForeignKeys(await unseededTestDb());
    expect(MUST_LEAD.filter((column) => unindexed.includes(column))).toEqual([]);
  });

  it("do not grow the unindexed set past its ceiling", async () => {
    const unindexed = await unindexedPeopleForeignKeys(await unseededTestDb());
    expect(unindexed.length).toBeLessThanOrEqual(UNINDEXED_CEILING);
  });
});

describe("course prices", () => {
  it.each([["priceCents"], ["eLearningPriceCents"], ["privatePriceCents"]] as const)(
    "refuse a negative %s, as trip prices do",
    async (column) => {
      const db = await unseededTestDb();
      const [shop] = await db
        .insert(shops)
        .values({ name: "Price Reef", slug: "price-reef", timezone: "UTC" })
        .returning();
      if (!shop) throw new Error("shop insert failed");
      const course = {
        shopId: shop.id,
        title: `Open Water ${column}`,
        slug: `ow-${column.toLowerCase()}`,
      };
      await expect(db.insert(courses).values({ ...course, [column]: -1 })).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "23514" }),
      });
      await db.insert(courses).values({ ...course, [column]: 0 });
    },
  );
});
