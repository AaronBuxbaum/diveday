import { date, index, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { notificationDeliveryStatus } from "./notifications";

/**
 * **One Monday email per person per week, claimed before it is sent**
 * (`src/features/weekly-digest/store.ts`). The unique `(person_id, week_of)` pair is the
 * whole idempotency story: the hourly pass inserts the claim, and only the
 * pass whose insert landed sends, so a re-run, an overlapping invocation or a
 * second hour inside Monday's window can never mail the same week twice.
 *
 * `week_of` is the shop-local Monday the email is about, a calendar date with
 * no instant in it. `status` is null between the claim and the provider's
 * answer and then records what that answer was, on the same vocabulary as
 * `notification_deliveries`; a retryable failure is carried on by the generic
 * send queue under the kind's own idempotency key, not by a second claim.
 *
 * The one-click "stop these" link the email carries (`/unsubscribe/<token>`)
 * is a `weekly_digest_unsubscribe` capability (`src/db/capabilities.ts`,
 * issue #3721), minted once the claim lands. It is not on the claim, so the
 * link keeps working after the claim ages out with
 * H-20260730-evidence-retention-period-deletion's retention prune: an expired
 * opt-out would leave somebody unable to stop the mail.
 *
 * Both foreign keys cascade: a claim means nothing once its shop or person is
 * gone, so a demo shop's teardown never has to know this table exists.
 */
export const weeklyDigestSends = pgTable(
  "weekly_digest_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    weekOf: date("week_of", { mode: "string" }).notNull(),
    status: notificationDeliveryStatus("status"),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("weekly_digest_sends_person_week_unique").on(table.personId, table.weekOf),
    // Retention prunes by age, across shops.
    index("weekly_digest_sends_created_at_idx").on(table.createdAt),
  ],
);
