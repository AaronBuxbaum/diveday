import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { people, shops } from "./core";
import { notificationDeliveryStatus } from "./notifications";

/**
 * **One Monday email per person per week, claimed before it is sent**
 * (`src/db/weekly-digest.ts`). The unique `(person_id, week_of)` pair is the
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
 * `unsubscribe_token_hash` is the one-click "stop these" link the email
 * carries (`/unsubscribe/<token>`). It lives on the claim rather than in a
 * token table of its own because a send and its link are one thing: one row,
 * one token, never expiring (an expired opt-out would leave somebody unable to
 * stop the mail, the reasoning `person_courtesy_email_unsubscribe_tokens`
 * gives), and consuming it is an idempotent write to
 * `user_accounts.weekly_digest`. Rows age out with H-02's retention prune.
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
    unsubscribeTokenHash: text("unsubscribe_token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("weekly_digest_sends_person_week_unique").on(table.personId, table.weekOf),
    // Retention prunes by age, across shops.
    index("weekly_digest_sends_created_at_idx").on(table.createdAt),
  ],
);
