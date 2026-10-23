import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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

/**
 * **What every demo shop together spent on Claude, one row per UTC month**
 * (Aaron, 2026-10-23): the shared demo allowance's ledger. Demos are deleted
 * by the reaper and by the mint cap, and their `claude_usage` rows cascade
 * with them, so a sum over live demos would forget a deleted demo's spend and
 * refill the allowance (security review, 2026-10-23). This row has no shop and
 * survives every delete; `src/db/assists.ts` adds each demo reservation and
 * settles it under the demo lock. A month and a number, no person.
 */
export const claudeDemoSpend = pgTable("claude_demo_spend", {
  /** The first day of the UTC month, `YYYY-MM-01`. */
  month: text("month").primaryKey(),
  spentMicroUsd: bigint("spent_micro_usd", { mode: "number" }).notNull().default(0),
});

/**
 * **What an assist answered, kept where asking again would be waste**: the
 * review chips (`review_flags`, one row per review), the owner's monthly
 * review themes (`review_themes`, one per month) and the Monday read
 * (`monday_read`, one per week, grade and language). `subject_key` names what
 * the answer is about inside the feature; `input_digest` fingerprints what was
 * sent, so a changed input is asked again rather than served stale.
 *
 * Codes, ids and the shop's own derived sentences only. The themes hold review
 * ids, never quotes, and the page reads each quote from its review row, so an
 * erased or unpublished review leaves with its row. Rows cascade with the shop
 * and age out with H-02's retention prune.
 */
export const assistResults = pgTable(
  "assist_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    subjectKey: text("subject_key").notNull(),
    value: jsonb("value").notNull(),
    inputDigest: text("input_digest").notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("assist_results_subject_unique").on(table.shopId, table.feature, table.subjectKey),
    index("assist_results_updated_at_idx").on(table.updatedAt),
  ],
);

/**
 * **A shop's own words in another language** (the `shop-translate` assist):
 * the Spanish of a trip description, course summary or a dive-site
 * briefing, written or drafted by the shop and saved by staff. A diver page in
 * that language shows it instead of the original while `source_digest` still
 * matches the original's words; edit the original and the translation stops
 * showing until it is saved again.
 *
 * Only the fields `TRANSLATABLE_FIELDS` lists (`src/lib/assists/shop-translate.ts`)
 * are ever written: never a waiver, a medical question or a course form (H-01,
 * H-03). An emptied box stores null rather than removing the row.
 */
export const shopTextTranslations = pgTable(
  "shop_text_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    field: text("field").notNull(),
    locale: text("locale").notNull(),
    text: text("text"),
    sourceDigest: text("source_digest").notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("shop_text_translations_subject_unique").on(
      table.shopId,
      table.subjectKind,
      table.subjectId,
      table.field,
      table.locale,
    ),
    check(
      "shop_text_translations_kind",
      sql`${table.subjectKind} in ('trip', 'course', 'dive_site')`,
    ),
  ],
);
