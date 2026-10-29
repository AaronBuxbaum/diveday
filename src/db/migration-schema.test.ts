import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { rentalFitProfiles as migrationProfiles } from "./migration-schema";
import { rentalFitProfiles } from "./schema";

const ctx = fileScopedShopContext();

it("removes the retired fit column and enum value from runtime and migration schemas", async () => {
  const runtime = getTableConfig(rentalFitProfiles)
    .columns.map((column) => column.name)
    .sort();
  const migration = getTableConfig(migrationProfiles)
    .columns.map((column) => column.name)
    .sort();
  expect(migration).toEqual(runtime);
  expect(runtime).not.toContain("rents_mask_fins");

  const { rows } = await ctx.db.execute(sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_fit_profiles'
  `);
  expect(rows.map((row) => row.column_name)).not.toContain("rents_mask_fins");
  expect(ctx.db.select().from(rentalFitProfiles).toSQL().sql).not.toContain("rents_mask_fins");
  await ctx.db.select().from(rentalFitProfiles).limit(1);

  const { rows: enumRows } = await ctx.db.execute(sql`
    select e.enumlabel from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'rental_fit_item'
  `);
  expect(enumRows.map((row) => row.enumlabel)).not.toContain("mask_fins");
});
