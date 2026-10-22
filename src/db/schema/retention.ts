import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";

/** Global scheduler machinery: a table code only, no shop, person or age-based trail. */
export const retentionPruneState = pgTable(
  "retention_prune_state",
  {
    id: text("id").primaryKey(),
    nextTable: text("next_table").notNull(),
  },
  (table) => [check("retention_prune_state_singleton", sql`${table.id} = 'weekly'`)],
);
