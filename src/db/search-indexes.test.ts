import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { getTableName, isTable, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { unseededTestDb } from "@/test/db";

/**
 * Every leading-wildcard `ILIKE` this app runs has a trigram index under it.
 *
 * Not a list of the three columns DATA-L6 (review 20260802) found unindexed —
 * that would close those three and let the fourth arrive the same way they did.
 * The set of searched columns is read out of `src/db/**` itself and checked
 * against the indexes the committed migrations actually built, so adding an
 * `ilike(...)` arm without an index fails here rather than on the first shop
 * with a real order history. A plain btree cannot serve `'%query%'`, so an
 * unindexed arm is a sequential scan of the whole table on every keystroke:
 * invisible on a demo shop, linear on a working one.
 */

/** `ilike(<table>.<column>, …)` call sites, as `table.column` pairs. */
const ILIKE_ARM = /\bilike\(\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;

type SearchedColumn = { file: string; table: string; column: string };

function searchedColumns(): SearchedColumn[] {
  const files = globSync("src/db/**/*.ts", { cwd: process.cwd() }).filter(
    (file) => !file.endsWith(".test.ts"),
  );
  const found: SearchedColumn[] = [];
  for (const file of files.sort()) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    for (const [, tableRef, columnRef] of source.matchAll(ILIKE_ARM)) {
      const table = (schema as Record<string, unknown>)[tableRef];
      // A local alias or a subquery rather than one of the schema's own tables.
      // Nothing today takes this branch; if something does, it is a real search
      // arm this file can no longer vouch for, so it fails rather than skips.
      if (!isTable(table)) throw new Error(`${file}: ilike on unknown table \`${tableRef}\``);
      const column = (table as unknown as Record<string, { name?: string }>)[columnRef];
      if (!column?.name) throw new Error(`${file}: ilike on unknown column \`${columnRef}\``);
      found.push({ file, table: getTableName(table), column: column.name });
    }
  }
  return found;
}

/** `table.column` pairs carrying a `gin_trgm_ops` index, read from the live database. */
async function trigramIndexed(): Promise<Set<string>> {
  const db = await unseededTestDb();
  const result = await db.execute<{ tablename: string; indexdef: string }>(sql`
    select tablename, indexdef
      from pg_indexes
     where schemaname = 'public' and indexdef like '%gin_trgm_ops%'
  `);
  const rows = (Array.isArray(result) ? result : (result.rows ?? [])) as {
    tablename: string;
    indexdef: string;
  }[];
  const indexed = new Set<string>();
  for (const row of rows) {
    for (const [, column] of row.indexdef.matchAll(/"?(\w+)"?\s+gin_trgm_ops/g)) {
      indexed.add(`${row.tablename}.${column}`);
    }
  }
  return indexed;
}

describe("leading-wildcard ILIKE search is indexed (DATA-L6)", () => {
  it("has a trigram index behind every column src/db searches with ilike", async () => {
    const searched = searchedColumns();
    const indexed = await trigramIndexed();

    // A regex that stopped matching would make the assertion below pass against
    // nothing at all, which is the one way this guard can quietly stop working.
    expect(searched.length).toBeGreaterThan(8);

    const unindexed = searched
      .filter((arm) => !indexed.has(`${arm.table}.${arm.column}`))
      .map((arm) => `${arm.table}.${arm.column} (${arm.file})`);
    expect(unindexed).toEqual([]);
  });

  it("names the three arms DATA-L6 found scanning, and the one already covered", async () => {
    // Legible closure for the finding, and the honest half of it: the review
    // named orders, but `pagedShopOrders`' filter is on the payer's name, which
    // has ridden `people_full_name_trgm_idx` since CR-018. The unindexed orders
    // arm was the *description* half of the command palette's `or`.
    const indexed = await trigramIndexed();

    expect(indexed).toContain("courses.title");
    expect(indexed).toContain("orders.description");
    expect(indexed).toContain("dive_sites.location_name");
    expect(indexed).toContain("people.full_name");
  });
});

/**
 * **The one search arm that is not an `ilike` on a column.**
 *
 * `people.phone` is free text, so search compares digits to digits — a
 * `regexp_replace(...)` expression rather than a plain column reference (issue
 * #719). The sweep above cannot see it: it reads `ilike(<table>.<column>` call
 * sites, and this arm is neither.
 *
 * That matters more than it looks. Postgres only uses an expression index when
 * the query's expression is *character-for-character* the one the index was
 * built on, so a whitespace difference between these two files does not fail
 * anything — it silently turns every bare-digit search into a sequential scan
 * of `people`, which is exactly the failure mode DATA-L6 was about.
 */
describe("the phone-digits search expression", () => {
  // Deliberately a plain string, `${…}` and all: this *is* the source text the
  // two files must share, so interpolating it here would compare something
  // neither of them contains. The placeholder is drizzle's, not JavaScript's.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the thing under test
  const DIGITS_EXPRESSION = "regexp_replace(coalesce(${people.phone}, ''), '[^0-9]', '', 'g')";

  it("is the same expression in the query and in the index", async () => {
    const query = readFileSync(path.join(process.cwd(), "src/db/search.ts"), "utf8");
    const schemaSource = readFileSync(path.join(process.cwd(), "src/db/schema.ts"), "utf8");

    expect(query).toContain(DIGITS_EXPRESSION);
    // The schema writes it against `table.phone` rather than `people.phone`,
    // which is the only difference allowed — everything else must match.
    expect(schemaSource).toContain(DIGITS_EXPRESSION.replace("people.phone", "table.phone"));
  });

  it("is backed by a committed index", async () => {
    const db = await unseededTestDb();
    const result = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'people_phone_digits_trgm_idx'`,
    );
    // Same unwrap the sweep above uses — the driver returns either shape.
    const [row] = (Array.isArray(result) ? result : (result.rows ?? [])) as { indexdef: string }[];
    expect(row?.indexdef).toBeTruthy();
    // GIN, not btree: a btree cannot serve `like '%digits%'` any better here
    // than it can on the raw column.
    expect(row?.indexdef).toContain("gin");
    // And built on the digits, not the raw column — an index on `phone` would
    // exist, satisfy a careless assertion, and never be used by this query.
    expect(row?.indexdef).toContain("regexp_replace");
  });
});
