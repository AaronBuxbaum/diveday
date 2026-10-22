import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { shops } from "./core";

/**
 * **Every Claude call, one row each** (ADR 20261018-claude-assists,
 * `src/db/assists.ts`). The per-shop monthly cap sums `cost_micro_usd` over the
 * shop's rows since the first of the UTC month, and the usage guardrail sums it
 * across shops against the platform ceiling (`src/lib/cost-guardrails.ts`).
 *
 * Codes and numbers only: `feature` is the assist's machine key (`inbox_draft`),
 * `outcome` is `StructuredOutcome` (`ok`, `refused`, …) and `error_code` a
 * transport code (`http_429`). Never the prompt, the answer, or a person: what
 * was sent lives nowhere but Anthropic's own retention.
 *
 * `cost_micro_usd` is computed at write time from the list price
 * (`costMicroUsd` in `src/lib/claude/models.ts`), so a later price change does
 * not rewrite history. Rows cascade with their shop and age out with H-02's
 * retention prune.
 */
export const claudeUsage = pgTable(
  "claude_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    // The cap's sum: one shop, this month.
    index("claude_usage_shop_created_at_idx").on(table.shopId, table.createdAt),
    // The platform guardrail's sum and the retention prune: every shop, by age.
    index("claude_usage_created_at_idx").on(table.createdAt),
  ],
);
