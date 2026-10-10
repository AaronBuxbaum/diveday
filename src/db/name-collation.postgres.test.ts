import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { courses, diveSites, gearItems, people, shops } from "./schema";

/**
 * **The committed `people.full_name` collation, against a real server.**
 *
 * `name-collation.test.ts` proves the same thing on PGlite, and that is the
 * half that cannot settle it: PGlite is a wasm build of Postgres 18 with ICU
 * compiled in, and the engine that ships is whatever CI's image and Neon
 * provide. `drizzle/20260911200158_person-name-collation` hard-fails with
 * `collation "und-x-icu" for encoding "UTF8" does not exist` on a server built
 * without ICU, so this file is where that question gets an answer before a
 * deploy asks it — `postgresTestDb()` applies the committed migrations, so
 * reaching the assertion at all is already half the proof.
 *
 * It is named `*.postgres.test.ts` because that glob is the whole contract:
 * CI's `real-postgres` job runs `src/db/*.postgres.test.ts` and nothing else,
 * and the unit shards skip `describePostgres` for want of
 * `DIVEDAY_TEST_POSTGRES_URL`. A real-server suite under any other filename is
 * a suite that runs nowhere (the comment on that job in `.github/workflows/
 * ci.yml` records the afternoon that happened).
 */

/** Scrambled on the way in, so a stable insert order cannot flatter the result. */
const NAMES = ["Zoe", "Ñuria", "Ana", "Bea", "Ángel"] as const;

/** What a Spanish reader looks for: accents beside their plain letters, `Ñ` after `N`. */
const ICU_ORDER = ["Ana", "Ángel", "Bea", "Ñuria", "Zoe"];

describePostgres("people.full_name on a real Postgres server", () => {
  it("sorts names by ICU order for a query that names no collation", async () => {
    const pg = await postgresTestDb();
    const db = pg.db;

    const suffix = randomBytes(4).toString("hex");
    const [shop] = await db
      .insert(shops)
      .values({
        name: `Collation Divers ${suffix}`,
        slug: `collation-${suffix}`,
        timezone: "America/New_York",
      })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");

    await db.insert(people).values(NAMES.map((fullName) => ({ shopId: shop.id, fullName })));

    const rows = await db
      .select({ fullName: people.fullName })
      .from(people)
      .orderBy(asc(people.fullName));

    expect(rows.map((row) => row.fullName)).toEqual(ICU_ORDER);
  });

  it("sorts dive sites, gear tags and courses by ICU order too (issue #1708)", async () => {
    const pg = await postgresTestDb();
    const db = pg.db;

    const suffix = randomBytes(4).toString("hex");
    const [shop] = await db
      .insert(shops)
      .values({
        name: `Collation Lists ${suffix}`,
        slug: `collation-lists-${suffix}`,
        timezone: "America/New_York",
      })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");

    await db
      .insert(diveSites)
      .values(NAMES.map((name, at) => ({ shopId: shop.id, name, slug: `site-${at}` })));
    await db
      .insert(gearItems)
      .values(NAMES.map((label) => ({ shopId: shop.id, kind: "bcd" as const, label })));
    await db
      .insert(courses)
      .values(NAMES.map((title, at) => ({ shopId: shop.id, title, slug: `course-${at}` })));

    const sites = await db
      .select({ name: diveSites.name })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .orderBy(asc(diveSites.name));
    const gear = await db
      .select({ label: gearItems.label })
      .from(gearItems)
      .where(eq(gearItems.shopId, shop.id))
      .orderBy(asc(gearItems.label));
    const roster = await db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .orderBy(asc(courses.title));

    expect(sites.map((row) => row.name)).toEqual(ICU_ORDER);
    expect(gear.map((row) => row.label)).toEqual(ICU_ORDER);
    expect(roster.map((row) => row.title)).toEqual(ICU_ORDER);
  });
});
