import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { issueBookingCapability } from "./booking-capabilities";
import { bookings } from "./schema";

/**
 * **The retired token columns hold nothing openable** (#3901, #3903; security
 * review of layer 2, S1). The schema stopped declaring
 * `booking_capabilities.token_hash`/`token_sealed` and
 * `waiver_records.token_sealed`, so nothing writes or clears them any more,
 * but the columns stay until next release's drop. The release migration clears
 * every stored copy, so a database dump taken in between carries no sealed link.
 */
const ctx = fileScopedShopContext();
const MIGRATION = path.join(
  process.cwd(),
  "drizzle/20261105154005_waiver-seal-acknowledgements/migration.sql",
);

function clearingStatements(): string[] {
  return readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.startsWith("UPDATE"));
}

describe("the release migration clears the retired token columns", () => {
  it("nulls every sealed waiver link and every stored booking-link copy", async () => {
    const { db, shop } = ctx;
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(1);
    if (!booking) throw new Error("seeded booking missing");
    await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: booking.id,
      purpose: "readiness",
    });
    await db.execute(
      sql`update waiver_records set token_sealed = 'sealed-before-deploy' where shop_id = ${shop.id}`,
    );
    await db.execute(
      sql`update booking_capabilities set token_sealed = 'sealed', token_hash = 'hash' where shop_id = ${shop.id}`,
    );
    const seeded = await db.execute(
      sql`select (select count(*)::int from waiver_records where token_sealed is not null) as w,
                 (select count(*)::int from booking_capabilities where token_hash is not null) as b`,
    );
    expect(seeded.rows[0]).toEqual({ w: expect.any(Number), b: expect.any(Number) });
    const { w, b } = seeded.rows[0] as { w: number; b: number };
    expect(w).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    const statements = clearingStatements();
    expect(statements).toHaveLength(2);
    for (const statement of statements) await db.execute(sql.raw(statement));

    const waivers = await db.execute(
      sql`select count(*)::int as n from waiver_records where token_sealed is not null`,
    );
    const links = await db.execute(
      sql`select count(*)::int as n from booking_capabilities where token_sealed is not null or token_hash is not null`,
    );
    expect(waivers.rows[0]).toEqual({ n: 0 });
    expect(links.rows[0]).toEqual({ n: 0 });
  });
});
