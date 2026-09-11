// @vitest-environment node
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
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

/**
 * `db.execute` hands back a bare array on one driver and a `{ rows }` result on
 * another; `src/db/search-indexes.test.ts` normalises the same way.
 */
const resultRows = <Row>(result: Row[] | { rows?: Row[] }): Row[] =>
  Array.isArray(result) ? result : (result.rows ?? []);

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

/**
 * **What the collation deliberately does not move**, because the migration's
 * destructive acknowledgement says so and no guard can check a *why*.
 *
 * `und-x-icu` as `initdb` creates it is deterministic, so `=` and any unique
 * index over `full_name` stay byte equality — that is the sentence that makes
 * the change tenancy-safe, and it stops being true the day somebody swaps in a
 * `…-x-icu` collation built with `deterministic = false`. Case folding *does*
 * move (ICU folds the whole Unicode range, an explicit `C` folds ASCII only),
 * and the trap is reading that as accent folding: it is not, and a search that
 * claimed it was would be promising divers something the database never does.
 */
describe("people.full_name matching, not ordering", () => {
  it("keeps equality byte-exact: the collation is deterministic", async () => {
    const rows = await ctx.db.execute<{ collname: string; collisdeterministic: boolean }>(sql`
      select c.collname, c.collisdeterministic
        from pg_attribute a
        join pg_collation c on c.oid = a.attcollation
       where a.attrelid = 'people'::regclass and a.attname = 'full_name'
    `);
    expect(resultRows(rows)).toEqual([{ collname: "und-x-icu", collisdeterministic: true }]);
  });

  it("folds case but never accents, so a search says what it means", async () => {
    const [inserted] = await ctx.db
      .insert(people)
      .values({ shopId: ctx.shop.id, fullName: "ÁNGEL RUIZ" })
      .returning({ id: people.id });
    if (!inserted) throw new Error("person insert returned no row");

    const matches = async (query: string) =>
      (
        await ctx.db
          .select({ id: people.id })
          .from(people)
          .where(and(eq(people.id, inserted.id), ilike(people.fullName, `%${query}%`)))
      ).length === 1;

    expect(await matches("ángel")).toBe(true);
    // Not accent-insensitive. `und-x-icu` is deterministic and `ILIKE` folds
    // case, not diacritics; an accent-blind search would need `unaccent`.
    expect(await matches("angel")).toBe(false);
  });
});

/**
 * **The indexes this migration rebuilt under an ACCESS EXCLUSIVE lock.**
 *
 * `ALTER COLUMN … TYPE` rewrote no rows — `text` to `text` is binary-coercible
 * — but Postgres rebuilds every index depending on a column whose collation
 * changed, inside the lock the statement already holds, and while it does the
 * live release can neither read nor write `people`. Today that is one GIN trgm
 * index over an empty table. A second index on this column would silently
 * widen that window for whoever changes the column next, which is why the set
 * is pinned rather than merely described: `pg_depend` is how Postgres itself
 * finds them, so an expression index counts here exactly as it counts there.
 */
describe("indexes depending on people.full_name", () => {
  it("is the one trigram index the acknowledgement names", async () => {
    const rows = await ctx.db.execute<{ index_name: string }>(sql`
      select distinct i.relname as index_name
        from pg_depend d
        join pg_class i on i.oid = d.objid and i.relkind = 'i'
       where d.classid = 'pg_class'::regclass
         and d.refclassid = 'pg_class'::regclass
         and d.refobjid = 'people'::regclass
         and d.refobjsubid = (
               select attnum from pg_attribute
                where attrelid = 'people'::regclass and attname = 'full_name'
             )
       order by 1
    `);
    expect(resultRows(rows).map((row) => row.index_name)).toEqual(["people_full_name_trgm_idx"]);
  });
});
