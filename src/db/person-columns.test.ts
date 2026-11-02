import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { PERSON_COLUMNS, personColumnKey } from "./person-columns";
import * as schema from "./schema";

const ctx = fileScopedShopContext();

/** Every column in the schema that references `people`, as `table.column`. */
async function referencesToPeople(): Promise<string[]> {
  const byConstraint = await ctx.db.execute(sql`
    select cl.relname as table_name, att.attname as column_name
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    cross join lateral unnest(con.conkey) as k(attnum)
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f' and ref.relname = 'people' and ns.nspname = 'public'
  `);
  const byName = await ctx.db.execute(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public' and column_name like '%person_id'
  `);
  const pairs = new Set<string>();
  for (const row of [...byConstraint.rows, ...byName.rows]) {
    const { table_name, column_name } = row as { table_name: string; column_name: string };
    pairs.add(`${table_name}.${column_name}`);
  }
  return [...pairs].sort();
}

describe("the person-column registry", () => {
  it("has a row for every column that references people, whatever it is called", async () => {
    const inSchema = await referencesToPeople();
    expect(inSchema.length).toBeGreaterThan(100);
    const registered = new Set(PERSON_COLUMNS.map(personColumnKey));
    expect(inSchema.filter((pair) => !registered.has(pair))).toEqual([]);
  });

  it("names only columns the schema still has", async () => {
    const live = new Set(await referencesToPeople());
    expect(PERSON_COLUMNS.map(personColumnKey).filter((pair) => !live.has(pair))).toEqual([]);
  });

  it("has one row per column", () => {
    const keys = PERSON_COLUMNS.map(personColumnKey);
    expect(keys.filter((key, at) => keys.indexOf(key) !== at)).toEqual([]);
  });

  it("names tables that exist", () => {
    const tables = new Set(
      Object.values(schema).flatMap((value) => {
        try {
          return [getTableConfig(value as Parameters<typeof getTableConfig>[0]).name];
        } catch {
          return [];
        }
      }),
    );
    expect(PERSON_COLUMNS.filter((row) => !tables.has(row.table)).map(personColumnKey)).toEqual([]);
  });

  /**
   * The fate and the kind have to agree, or a row is a claim nothing checks. A
   * moved column is a diver's own history and only a bare `person_id` moves; a
   * refused one is a staff or sign-in record; one left or deleted says why.
   */
  it("keeps kind, fate and reason consistent", () => {
    for (const row of PERSON_COLUMNS) {
      const key = personColumnKey(row);
      if (row.merge === "move") {
        expect([key, row.column, row.kind]).toEqual([key, "person_id", "subject"]);
      }
      if (row.merge === "refuse") {
        expect([key, row.column, ["crew", "login"].includes(row.kind)]).toEqual([
          key,
          "person_id",
          true,
        ]);
      }
      if (row.merge === "leave" || row.merge === "delete") {
        expect([key, (row.why ?? "").length > 0]).toEqual([key, true]);
      } else {
        expect([key, row.why]).toEqual([key, undefined]);
      }
      if (row.singleton) expect([key, row.merge]).toEqual([key, "move"]);
      if (row.withoutShop) expect([key, row.merge]).toEqual([key, "refuse"]);
    }
  });

  /**
   * Adversarial: erasure and merge both trust that a staff or sign-in record is
   * never moved onto a diver. Nothing a registry row says may let one through.
   */
  it("never moves a crew or login column", () => {
    const moved = PERSON_COLUMNS.filter((row) => row.merge === "move");
    expect(moved.filter((row) => row.kind === "crew" || row.kind === "login")).toEqual([]);
    expect(PERSON_COLUMNS.filter((row) => row.kind === "login" && row.merge === "move")).toEqual(
      [],
    );
  });
});
