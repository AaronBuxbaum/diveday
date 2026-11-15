import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";

/** Inert personal instrument evidence. Never a source for operational dive calculations. */
export const computerImportBatches = pgTable(
  "computer_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    selectionHash: text("selection_hash").notNull(),
    importedCount: integer("imported_count").notNull(),
    skippedCount: integer("skipped_count").notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("computer_import_request_unique").on(t.shopId, t.personId, t.requestKey),
    index("computer_import_person_idx").on(t.personId),
  ],
);

export const computerDives = pgTable(
  "computer_dives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => computerImportBatches.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    record: jsonb("record").$type<Record<string, unknown>>().notNull(),
    annotation: text("annotation").notNull().default(""),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("computer_dives_fingerprint_unique").on(t.shopId, t.personId, t.fingerprint),
    index("computer_dives_person_idx").on(t.personId),
    check("computer_dives_annotation_bounded", sql`length(${t.annotation}) <= 2000`),
  ],
);

export const computerDiveProfiles = pgTable(
  "computer_dive_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    diveId: uuid("dive_id")
      .notNull()
      .references(() => computerDives.id, { onDelete: "cascade" }),
    samples: jsonb("samples")
      .$type<Array<{ seconds: number; depthMeters: number; temperatureC?: number }>>()
      .notNull(),
  },
  (t) => [
    uniqueIndex("computer_dive_profile_unique").on(t.diveId),
    index("computer_profile_person_idx").on(t.personId),
    check("computer_profile_samples_bounded", sql`jsonb_array_length(${t.samples}) <= 10000`),
  ],
);
