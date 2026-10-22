import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { shops } from "./core";

/**
 * **What Claude drafted from a shop's own website** (ADR
 * 20261018-claude-assists; the `setup` assist): one row per shop, the latest
 * reading, replaced when the owner reads the site again. Kept so a page view
 * or an accepted line never pays for the reading twice.
 *
 * `lines` is a list of `SetupLine` (`src/lib/assists/website-setup.ts`): each
 * proposal, the sentence on the site it came from, and whether the owner has
 * accepted or dismissed it. Nothing in it is live: an accepted line is written
 * through the shop's own writers by the owner's tap, and a dismissed one
 * simply stops showing. It holds the shop's public website copy and no
 * person, and cascades with the shop.
 */
export const websiteSetupDrafts = pgTable("website_setup_drafts", {
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id, { onDelete: "cascade" }),
  /** The host the owner pasted, the one `web_fetch` was allowed to read. */
  host: text("host").notNull(),
  lines: jsonb("lines").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  createdAt: appNowTimestamp("created_at").notNull(),
});
