// @vitest-environment node
import { asc, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { people } from "./schema";

/**
 * **`people.full_name` carries its own ICU collation**, so a name-ordered list
 * comes out in the order a person expects without a single query saying so.
 *
 * Until `drizzle/20260911200158_person-name-collation` the order came from the
 * *database* default, which is `C` (byte order) on PGlite and whatever initdb
 * was handed on a server — so `Ángel` and `Ñuria` sorted after `Zoe` in this
 * suite and somewhere else entirely in production, and no test could say which
 * order a shop would see. That is not cosmetic: twenty-one
 * `orderBy(asc(people.fullName))` call sites across `src/db` feed `offsetPage`
 * (src/db/paging.ts), which slices exactly that order, so a wrong order is a
 * wrong *page one*.
 *
 * The assertion below is a **bare** `orderBy(asc(people.fullName))` on purpose.
 * Naming the collation in the query would prove only that Postgres can sort;
 * what needs proving is that a reader who names nothing inherits it, because
 * that is every reader this app has.
 *
 * The half a real server answers lives in `name-collation.postgres.test.ts` —
 * the committed migration has to meet a genuine Postgres before production,
 * and only `src/db/*.postgres.test.ts` runs in CI's `real-postgres` job.
 */

const ctx = fileScopedShopContext();

/** Scrambled on the way in, so a stable insert order cannot flatter the result. */
const NAMES = ["Zoe", "Ñuria", "Ana", "Bea", "Ángel"] as const;

/** What a Spanish reader looks for: accents beside their plain letters, `Ñ` after `N`. */
const ICU_ORDER = ["Ana", "Ángel", "Bea", "Ñuria", "Zoe"];

describe("people.full_name ordering (PGlite, the engine the suite runs on)", () => {
  it("returns ICU order from a query that names no collation", async () => {
    const inserted = await ctx.db
      .insert(people)
      .values(NAMES.map((fullName) => ({ shopId: ctx.shop.id, fullName })))
      .returning({ id: people.id });

    const rows = await ctx.db
      .select({ fullName: people.fullName })
      .from(people)
      .where(
        inArray(
          people.id,
          inserted.map((row) => row.id),
        ),
      )
      .orderBy(asc(people.fullName));

    expect(rows.map((row) => row.fullName)).toEqual(ICU_ORDER);
  });
});
