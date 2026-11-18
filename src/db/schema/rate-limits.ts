import { bigint, boolean, doublePrecision, pgTable, text } from "drizzle-orm/pg-core";

/**
 * One token bucket per abuse-control key (`src/lib/rate-limit.ts`). Shared by every
 * serverless instance, so a limit holds across all of them. The key is already a hash
 * (`rateLimitKey`), never a raw email, IP or token, and a bucket belongs to no shop: it
 * counts a source, not a record. Idle rows are swept by `takeFromBucket`.
 */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  /** Epoch milliseconds of the last take or refund, on the clock the caller passed. */
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  /** Whether the last take got a token; read back by the same statement that wrote it. */
  lastAllowed: boolean("last_allowed").notNull(),
});
