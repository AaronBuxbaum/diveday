import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { SetupLine } from "@/lib/assists/website-setup";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { shops, websiteSetupDrafts } from "./schema";
import { acceptSetupLine, dismissSetupLine, readWebsiteSetup } from "./website-setup";

/**
 * The website setup's taps on two real connections (review 2026-10-22, db #2).
 *
 * PGlite is one connection, so `website-setup.test.ts` can show that a tap
 * writes only its own line but not that two taps serialise. Here a gate holds
 * the draft row, both taps park behind it, and the outcome is what proves the
 * guard: without the `for update` both taps of one line read it open and both
 * write, and two taps on two lines rewrite each other's status.
 */

const readAt = new Date("2026-10-22T12:00:00Z");

const lines: SetupLine[] = [
  {
    key: "tagline-0",
    kind: "tagline",
    text: "Small boats",
    source: "Small boats.",
    status: "open",
  },
  { key: "phone-1", kind: "phone", text: "+1 305 555 0199", source: "Call", status: "open" },
];

async function shopWithReading(db: AppDb): Promise<string> {
  const [row] = await db
    .insert(shops)
    .values({ name: "setup", slug: `setup-${randomBytes(4).toString("hex")}`, timezone: "UTC" })
    .returning({ id: shops.id });
  if (!row) throw new Error("shop insert returned no row");
  await db
    .insert(websiteSetupDrafts)
    .values({ shopId: row.id, host: "example.com", lines, readAt });
  return row.id;
}

const key = (lineKey: string) => `${readAt.getTime()}.${lineKey}`;

function gate(shopId: string) {
  return sql`select 1 from website_setup_drafts where shop_id = ${shopId} for update`;
}

describePostgres("website setup taps under real concurrency", () => {
  it("writes a double-tapped line once", async () => {
    const pg = await postgresTestDb();
    const shopId = await shopWithReading(pg.db);
    const personId = randomUUID();
    const held = await holdRowLock(pg, gate(shopId));
    const taps = [pg.connect(), pg.connect()].map((db) =>
      acceptSetupLine(db, { shopId, personId, key: key("tagline-0") }),
    );
    await waitForLockWaiters(pg.db, 2);
    await held.release();
    expect((await Promise.all(taps)).sort()).toEqual(["gone", "saved"]);
  });

  it("dismisses a double-tapped line once", async () => {
    const pg = await postgresTestDb();
    const shopId = await shopWithReading(pg.db);
    const held = await holdRowLock(pg, gate(shopId));
    const taps = [pg.connect(), pg.connect()].map((db) =>
      dismissSetupLine(db, shopId, key("phone-1")),
    );
    await waitForLockWaiters(pg.db, 2);
    await held.release();
    expect((await Promise.all(taps)).sort()).toEqual([false, true]);
  });

  it("keeps both lines accepted when two lines are tapped at once", async () => {
    const pg = await postgresTestDb();
    const shopId = await shopWithReading(pg.db);
    const personId = randomUUID();
    const held = await holdRowLock(pg, gate(shopId));
    const taps = [
      acceptSetupLine(pg.connect(), { shopId, personId, key: key("tagline-0") }),
      acceptSetupLine(pg.connect(), { shopId, personId, key: key("phone-1") }),
    ];
    await waitForLockWaiters(pg.db, 2);
    await held.release();
    expect(await Promise.all(taps)).toEqual(["saved", "saved"]);
    const after = await readWebsiteSetup(pg.db, shopId);
    expect(after?.lines.map((line) => line.status)).toEqual(["accepted", "accepted"]);
    const [shop] = await pg.db
      .select({ tagline: shops.tagline, phone: shops.contactPhone })
      .from(shops)
      .where(eq(shops.id, shopId));
    expect(shop).toEqual({ tagline: "Small boats", phone: "+1 305 555 0199" });
  });
});
