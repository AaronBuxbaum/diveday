import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { shops } from "./core";
import { trips } from "./trips";

/**
 * Server-owned ordering for saved manifest snapshots. The row lock serializes
 * snapshots for one trip without changing the shop-wide erasure epoch; the
 * monotonically increasing revision lets a device reject a late older render.
 */
export const offlineManifestSnapshotRevisions = pgTable(
  "offline_manifest_snapshot_revisions",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({
      name: "offline_manifest_snapshot_revisions_pk",
      columns: [table.shopId, table.tripId],
    }),
    check("offline_manifest_snapshot_revisions_positive", sql`${table.revision} > 0`),
  ],
);
