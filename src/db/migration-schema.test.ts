import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { rentalFitProfiles as migrationProfiles } from "./migration-schema";
import {
  bookingCapabilities,
  calendarFeeds,
  diveSites,
  interestUnsubscribeTokens,
  personCourtesyEmailUnsubscribeTokens,
  rentalFitProfiles,
} from "./schema";

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

it("keeps each natural-key unique index without its duplicate lookup index", async () => {
  const expected = ["dive_sites_shop_name_unique", "rental_fit_profiles_shop_person_unique"];
  const indexes = [diveSites, rentalFitProfiles].flatMap((table) =>
    getTableConfig(table).indexes.map((index) => index.config),
  );
  expect(indexes.find((index) => index.name === expected[0])?.unique).toBe(true);
  expect(indexes.find((index) => index.name === expected[1])?.unique).toBe(true);
  expect(indexes.map((index) => index.name)).not.toContain("dive_sites_shop_name_idx");
  expect(indexes.map((index) => index.name)).not.toContain("rental_fit_profiles_shop_person_idx");

  const result = await ctx.db.execute<{ indexname: string; indexdef: string }>(sql`
    select indexname, indexdef
      from pg_indexes
     where schemaname = 'public'
       and indexname in (
         'dive_sites_shop_name_unique', 'dive_sites_shop_name_idx',
         'rental_fit_profiles_shop_person_unique', 'rental_fit_profiles_shop_person_idx'
       )
     order by indexname
  `);
  expect(result.rows.map((row) => row.indexname)).toEqual([...expected].sort());
  expect(result.rows.every((row) => row.indexdef.startsWith("CREATE UNIQUE INDEX"))).toBe(true);
});

it("keeps token-hash uniqueness while dropping only duplicate lookup indexes", async () => {
  const tokenTables = [
    "booking_capabilities",
    "calendar_feeds",
    "interest_unsubscribe_tokens",
    "person_courtesy_email_unsubscribe_tokens",
  ];
  const tables = [
    bookingCapabilities,
    calendarFeeds,
    interestUnsubscribeTokens,
    personCourtesyEmailUnsubscribeTokens,
  ];
  for (const table of tables) {
    const config = getTableConfig(table);
    const tokenHash = config.columns.find((column) => column.name === "token_hash");
    expect(tokenHash?.notNull).toBe(true);
    expect(tokenHash?.isUnique).toBe(true);
  }

  const result = await ctx.db.execute<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>(sql`
    select tablename, indexname, indexdef
      from pg_indexes
     where schemaname = 'public'
       and tablename in (
         'booking_capabilities', 'calendar_feeds',
         'interest_unsubscribe_tokens', 'person_courtesy_email_unsubscribe_tokens'
       )
       and indexdef like '%(token_hash)%'
     order by tablename, indexname
  `);
  expect(result.rows.map((row) => row.tablename)).toEqual(tokenTables);
  expect(result.rows.every((row) => row.indexdef.startsWith("CREATE UNIQUE INDEX"))).toBe(true);
  expect(result.rows.map((row) => row.indexname)).not.toContain(
    "person_courtesy_email_unsubscribe_tokens_token_hash_idx",
  );
  expect(result.rows.map((row) => row.indexname)).not.toContain(
    "interest_unsubscribe_tokens_token_hash_idx",
  );
  expect(result.rows.map((row) => row.indexname)).not.toContain("calendar_feeds_token_hash_idx");
  expect(result.rows.map((row) => row.indexname)).not.toContain(
    "booking_capabilities_token_hash_idx",
  );
});
