import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";

/**
 * **Retired token columns are gone from the database** (#3901, #3903).
 * Booking and waiver links are derived from their row (ADR
 * 20261104-derived-booking-link-tokens; ADR
 * 20260820-waiver-links-are-reused-not-reissued, amended), so no table keeps a
 * stored or sealed copy of a link. One release stopped declaring
 * these columns and cleared them; the next drops them, so a dump holds no
 * column that ever carried an openable link.
 */
const ctx = fileScopedShopContext();

const RETIRED: ReadonlyArray<readonly [table: string, column: string]> = [
  ["booking_capabilities", "token_hash"],
  ["booking_capabilities", "token_sealed"],
  ["waiver_records", "token_sealed"],
];

describe("the retired token columns", () => {
  it.each(RETIRED)("%s.%s no longer exists", async (table, column) => {
    const found = await ctx.db.execute(
      sql`select 1 from information_schema.columns
          where table_schema = current_schema() and table_name = ${table} and column_name = ${column}`,
    );
    expect(found.rows).toEqual([]);
  });
});
