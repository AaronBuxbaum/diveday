import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
 * The set of searched columns is read out of `src/db/**` and `src/features/**` and checked
 * against the indexes the committed migrations actually built, so adding an
 * `ilike(...)` arm without an index fails here rather than on the first shop
 * with a real order history. A plain btree cannot serve `'%query%'`, so an
 * unindexed arm is a sequential scan of the whole table on every keystroke:
 * invisible on a demo shop, linear on a working one.
 */

type SearchedColumn = { file: string; table: string; column: string };

// TypeScript 7 is a native compiler, not the old JavaScript compiler API.
// Next already ships Babel's TypeScript parser for its own tooling. This
// test-only adapter deliberately fails if that parser contract disappears.
type SourceNode = { type: string; [key: string]: unknown };
const { parse } = createRequire(import.meta.url)("next/dist/compiled/babel/parser") as {
  parse(source: string, options: { sourceType: string; plugins: string[] }): SourceNode;
};
function sourceNode(value: unknown): SourceNode | undefined {
  return value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string"
    ? (value as SourceNode)
    : undefined;
}
function identifier(value: unknown): string | undefined {
  const node = sourceNode(value);
  return node?.type === "Identifier" && typeof node.name === "string" ? node.name : undefined;
}
function walk(node: SourceNode, visit: (node: SourceNode) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const next = sourceNode(child);
      if (next) walk(next, visit);
    }
  }
}
function columnsInSource(source: string, file: string): SearchedColumn[] {
  if (!/\bilike\b/.test(source)) return [];
  const parsed = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const ilikeNames = new Set(["ilike"]);
  const aliases = new Map<string, string>();
  walk(parsed, (node) => {
    if (node.type !== "ImportSpecifier") return;
    const original = identifier(node.imported);
    const local = identifier(node.local);
    if (!original || !local) return;
    if (original === "ilike") ilikeNames.add(local);
    if (isTable((schema as Record<string, unknown>)[original])) aliases.set(local, original);
  });
  walk(parsed, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const original = identifier(node.init);
    const local = identifier(node.id);
    if (original && local && ilikeNames.has(original)) ilikeNames.add(local);
  });
  const found: SearchedColumn[] = [];
  walk(parsed, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = sourceNode(node.callee);
    const name = identifier(callee);
    const namespaceIlike =
      callee?.type === "MemberExpression" && identifier(callee.property) === "ilike";
    if ((!name || !ilikeNames.has(name)) && !namespaceIlike) return;
    const arm = sourceNode(Array.isArray(node.arguments) ? node.arguments[0] : undefined);
    const tableName =
      arm?.type === "MemberExpression" && !arm.computed ? identifier(arm.object) : undefined;
    const columnName = arm ? identifier(arm.property) : undefined;
    if (!tableName || !columnName) throw new Error(`${file}: unaudited ilike expression`);
    const tableRef = aliases.get(tableName) ?? tableName;
    const table = (schema as Record<string, unknown>)[tableRef];
    if (!isTable(table)) throw new Error(`${file}: ilike on unknown table ${tableRef}`);
    const column = (table as unknown as Record<string, { name?: string }>)[columnName];
    if (!column?.name) throw new Error(`${file}: ilike on unknown column ${columnName}`);
    found.push({ file, table: getTableName(table), column: column.name });
  });
  return found;
}

function searchedColumns(): SearchedColumn[] {
  return globSync(["src/db/**/*.ts", "src/features/**/*.ts"], { cwd: process.cwd() })
    .filter((file) => !file.endsWith(".test.ts"))
    .sort()
    .flatMap((file) => columnsInSource(readFileSync(path.join(process.cwd(), file), "utf8"), file));
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
  it("has a trigram index behind every column src/db and src/features search with ilike", async () => {
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

  it("rejects an unindexed feature-side search arm", async () => {
    const indexed = await trigramIndexed();
    const [arm] = columnsInSource('ilike(people.id, "%needle%")', "src/features/example/store.ts");
    expect(arm?.file).toBe("src/features/example/store.ts");
    expect(indexed.has(`${arm?.table}.${arm?.column}`)).toBe(false);
    expect(searchedColumns().some((entry) => entry.file === "src/features/search/store.ts")).toBe(
      true,
    );
  });

  it("resolves imported aliases and refuses unknown aliases and dynamic expressions", () => {
    expect(
      columnsInSource(
        'import { people as p } from "@/db/schema"; import { ilike as matches } from "drizzle-orm"; matches(p.fullName, q)',
        "feature.ts",
      ),
    ).toEqual([{ file: "feature.ts", table: "people", column: "full_name" }]);
    expect(() => columnsInSource("ilike(unknown.name, q)", "feature.ts")).toThrow("unknown table");
    expect(() => columnsInSource("ilike(expression(), q)", "feature.ts")).toThrow(
      "unaudited ilike expression",
    );
    expect(() => columnsInSource("orm.ilike(expression(), q)", "feature.ts")).toThrow(
      "unaudited ilike expression",
    );
    expect(() =>
      columnsInSource("const matches = ilike; matches(expression(), q)", "feature.ts"),
    ).toThrow("unaudited ilike expression");
    expect(columnsInSource("// ilike(unknown.name, q)", "feature.ts")).toEqual([]);
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
 * It lives in `src/db/person-search.ts`, the one predicate every staff search
 * box runs, rather than in the command palette that first needed it — four
 * copies of that predicate had drifted, and only the palette's normalised a
 * phone number at all (issue #1765).
 *
 * That matters more than it looks. Postgres matches a query to an expression
 * index by comparing *parsed trees*, not source text, so whitespace alone is
 * harmless — but any real difference in the expression (a different character
 * class, a missing `coalesce`, a different column) leaves the index unmatched
 * and silently turns every bare-digit search into a sequential scan of
 * `people`, which is exactly the failure mode DATA-L6 was about. Comparing the
 * source text of the two files is a stricter rule than Postgres's, chosen
 * because it is the one a test can actually check cheaply; the second test
 * below reads what Postgres *stored*, which is the honest half.
 */
describe("the phone-digits search expression", () => {
  // Deliberately a plain string, `${…}` and all: this *is* the source text the
  // two files must share, so interpolating it here would compare something
  // neither of them contains. The placeholder is drizzle's, not JavaScript's.
  const DIGITS_EXPRESSION = "regexp_replace(coalesce(${people.phone}, ''), '[^0-9]', '', 'g')";

  it("is the same expression in the query and in the index", async () => {
    const query = readFileSync(path.join(process.cwd(), "src/db/person-search.ts"), "utf8");
    const schemaSource = readFileSync(path.join(process.cwd(), "src/db/schema/core.ts"), "utf8");

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
    // **The character class, not merely the function name.** The failure this
    // test exists for is drizzle-kit swallowing a backslash and writing `'D'`
    // where `'\D'` was meant — an index that strips the letter D, is never
    // matched to this query, and contains both `gin` and `regexp_replace`
    // while doing it. `[^0-9]` is what the schema writes for exactly that
    // reason, so this asserts the body Postgres actually stored.
    expect(row?.indexdef).toContain("'[^0-9]'");
  });
});
