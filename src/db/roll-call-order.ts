import { type AnyColumn, and, asc, desc, eq, gt, or } from "drizzle-orm";
import { rollCallEvents } from "./schema";

/**
 * The order of roll-call marks, in one place. Newest wins on `occurred_at`,
 * then `created_at`, then `seq` (ADR 20260815-roll-call-order-is-a-property-of-the-data):
 * two taps in the same millisecond, or an offline batch replayed with one
 * `occurred_at`, are still told apart. Forgetting `seq` once left every test green
 * and a diver reading as back aboard. `scripts/check-roll-call-subject.mjs`
 * refuses a reference to a roll-call `.seq` anywhere but here.
 *
 * Each helper takes the table or an `alias()` of it.
 */
type OrderedMarks = { occurredAt: AnyColumn; createdAt: AnyColumn; seq: AnyColumn };

/** `orderBy(...newestMarkFirst())`: the first row per subject and checkpoint is its standing mark. */
export function newestMarkFirst(table: OrderedMarks = rollCallEvents) {
  return [desc(table.occurredAt), desc(table.createdAt), desc(table.seq)] as const;
}

/** `orderBy(...oldestMarkFirst())`: the timeline order, as the export and the incident pack read it. */
export function oldestMarkFirst(table: OrderedMarks = rollCallEvents) {
  return [asc(table.occurredAt), asc(table.createdAt), asc(table.seq)] as const;
}

/** True where `newer` was recorded after `older`, for a "no newer mark exists" anti-join. */
export function isNewerMark(newer: OrderedMarks, older: OrderedMarks) {
  return or(
    gt(newer.occurredAt, older.occurredAt),
    and(eq(newer.occurredAt, older.occurredAt), gt(newer.createdAt, older.createdAt)),
    and(
      eq(newer.occurredAt, older.occurredAt),
      eq(newer.createdAt, older.createdAt),
      gt(newer.seq, older.seq),
    ),
  );
}
