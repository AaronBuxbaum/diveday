import { pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { rollCallEventClaims } from "./dive-day";
import { trips } from "./trips";

/** Staff deferred an item; the safety observation remains unresolved. */
export const unresolvedReviewDeferrals = pgTable(
  "unresolved_review_deferrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => rollCallEventClaims.id),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => people.id),
    reviewRevision: uuid("review_revision").notNull(),
    requestId: uuid("request_id").notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("unresolved_review_deferrals_shop_request_unique").on(
      table.shopId,
      table.requestId,
    ),
  ],
);
