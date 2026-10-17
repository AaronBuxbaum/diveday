import { timestamp } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";

/**
 * A timestamptz column that is stamped on insert. The database keeps its
 * `DEFAULT now()` for raw SQL and migrations; a Drizzle insert that leaves the
 * column out takes the application clock instead (`src/lib/clock.ts`), so a row
 * a test creates under a pinned `DIVEDAY_CLOCK` carries that instant and a
 * capture printing its date does not move with the wall clock. Chain
 * `.notNull()` where the column is required. Unpinned, `nowDate()` is
 * `new Date()`, so nothing changes in a real deployment (issue #2538).
 *
 * Use this for every `DEFAULT now()` column; `src/db/schema-clock-default.test.ts`
 * refuses a bare `.defaultNow()` anywhere in the schema.
 */
export function appNowTimestamp<TName extends string>(name: TName) {
  return timestamp(name, { withTimezone: true }).defaultNow().$defaultFn(nowDate);
}
