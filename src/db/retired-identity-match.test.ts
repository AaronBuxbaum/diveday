import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";

/**
 * **The shared-inbox match record is gone from the database** (#4113). A held
 * seat has one way in, the counter's name prompt, so `bookings.identity_booked_as`
 * says everything `identity_matched_by` did. One release stopped declaring the
 * column; this one drops it and its enum type.
 */
const ctx = fileScopedShopContext();

describe("the retired identity match record", () => {
  it("bookings.identity_matched_by no longer exists", async () => {
    const found = await ctx.db.execute(
      sql`select 1 from information_schema.columns
          where table_schema = current_schema() and table_name = 'bookings'
            and column_name = 'identity_matched_by'`,
    );
    expect(found.rows).toEqual([]);
  });

  it("the identity_match_kind type no longer exists", async () => {
    const found = await ctx.db.execute(
      sql`select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = current_schema() and t.typname = 'identity_match_kind'`,
    );
    expect(found.rows).toEqual([]);
  });
});
