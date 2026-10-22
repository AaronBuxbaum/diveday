import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  type AssistDarkReason,
  assistDarkReason,
  externalHttpDisabled,
  shopMonthlyCapMicroUsd,
} from "@/lib/claude/dark";
import { type ClaudeProvider, claudeProviderFromEnv } from "@/lib/claude/provider";
import {
  callStructured,
  type StructuredCall,
  type StructuredResult,
} from "@/lib/claude/structured";
import { nowDate } from "@/lib/clock";
import { periodBounds } from "@/lib/cost-guardrails";
import { log } from "@/lib/log";
import type { AppDb } from "./client";
import { claudeUsage, shops } from "./schema";

/**
 * **Running an assist** (ADR 20261018-claude-assists): the one function every
 * Claude feature calls. It decides whether the assist is dark, sends the call
 * through the provider seam, records what it cost, and answers the validated
 * value or `null`. It never throws: a caller treats `null` exactly as it
 * treats a shop with Claude switched off, and the feature carries on.
 *
 * Tenant scope is the caller's `shopId`, taken from the staff session. What is
 * sent is the caller's prompt; what is kept here is codes and token counts
 * only (`claude_usage`, `src/db/schema/assists.ts`).
 *
 * The cap is checked before the call and the spend recorded after, so two
 * calls racing at the line can both run: the overshoot is one call, cents at
 * most, and the next is refused. A lock would cost every call a round trip to
 * save less than that.
 */

export type AssistEnvironment = Readonly<Record<string, string | undefined>>;

export type AssistOptions = {
  /** A test's provider. Absent, the provider comes from `ANTHROPIC_API_KEY`. */
  readonly provider?: ClaudeProvider;
  readonly env?: AssistEnvironment;
  readonly now?: Date;
};

/** A feature key is a short code (`inbox_draft`), never a sentence or a name. */
const FEATURE_KEY = /^[a-z][a-z0-9_]{1,47}$/;

function providerFor(options: AssistOptions): ClaudeProvider | null {
  return options.provider ?? claudeProviderFromEnv(options.env ?? process.env);
}

/** The shop's recorded Claude spend since the first of this UTC month, in micro-USD. */
export async function shopClaudeSpendMicroUsd(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<number> {
  const { start, end } = periodBounds("calendar_month", now);
  const [row] = await db
    .select({ total: sql<string | null>`sum(${claudeUsage.costMicroUsd})` })
    .from(claudeUsage)
    .where(
      and(
        eq(claudeUsage.shopId, shopId),
        gte(claudeUsage.createdAt, start),
        lt(claudeUsage.createdAt, end),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * Every shop's recorded spend over `[start, end)`, in USD: the number the
 * platform's usage guardrail compares with its ceiling (`anthropic_spend` in
 * `src/lib/cost-guardrails.ts`).
 */
export async function claudeSpendUsdBetween(db: AppDb, start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${claudeUsage.costMicroUsd})` })
    .from(claudeUsage)
    .where(and(gte(claudeUsage.createdAt, start), lt(claudeUsage.createdAt, end)));
  return Number(row?.total ?? 0) / 1_000_000;
}

/** Why this shop's assists are dark right now, or null when they may run. */
export async function assistDarkReasonFor(
  db: AppDb,
  shopId: string,
  options: AssistOptions = {},
): Promise<AssistDarkReason | null> {
  const env = options.env ?? process.env;
  const hasKey = providerFor(options) !== null;
  // A test that injects its own provider is exercising the seam on purpose;
  // the fleet switch blocks only the real one (the `marine-forecast.ts` rule).
  const blocked = !options.provider && externalHttpDisabled(env);
  // The cheap checks first, so a dark deployment never reads the database.
  const early = assistDarkReason({
    hasKey,
    externalHttpDisabled: blocked,
    shopEnabled: true,
    spentMicroUsd: 0,
    capMicroUsd: 1,
  });
  if (early) return early;

  const [shop] = await db
    .select({ enabled: shops.claudeSuggestionsEnabled, isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop?.enabled) return "shop_off";

  return assistDarkReason({
    hasKey,
    externalHttpDisabled: blocked,
    shopEnabled: true,
    shopIsDemo: shop.isDemo,
    spentMicroUsd: await shopClaudeSpendMicroUsd(db, shopId, options.now ?? nowDate()),
    capMicroUsd: shopMonthlyCapMicroUsd(env),
  });
}

/**
 * Whether to offer an assist on a page at all. A page that is dark renders no
 * Draft button, so a shop with Claude off never sees a control that does
 * nothing.
 */
export async function assistsAvailable(
  db: AppDb,
  shopId: string,
  options: AssistOptions = {},
): Promise<boolean> {
  return (await assistDarkReasonFor(db, shopId, options)) === null;
}

async function recordClaudeUsage(
  db: AppDb,
  shopId: string,
  feature: string,
  result: StructuredResult<unknown>,
): Promise<void> {
  await db.insert(claudeUsage).values({
    shopId,
    feature,
    model: result.model,
    outcome: result.outcome,
    errorCode: result.errorCode ?? null,
    inputTokens: result.usage.inputTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    outputTokens: result.usage.outputTokens,
    costMicroUsd: result.costMicroUsd,
  });
}

export type RunAssistInput<S extends z.ZodType> = AssistOptions & {
  readonly shopId: string;
  /** The assist's code, recorded on the usage row: `inbox_draft`, `cert_scan`. */
  readonly feature: string;
  readonly call: StructuredCall<S>;
};

/** Runs one assist for one shop: the validated value, or null when dark or failed. */
export async function runAssist<S extends z.ZodType>(
  db: AppDb,
  input: RunAssistInput<S>,
): Promise<z.infer<S> | null> {
  const { shopId, feature } = input;
  if (!FEATURE_KEY.test(feature)) {
    log("claude_assist.bad_feature_key", "error", {});
    return null;
  }
  try {
    const dark = await assistDarkReasonFor(db, shopId, input);
    if (dark) {
      log("claude_assist.dark", "info", { feature, reason: dark });
      return null;
    }
    const provider = providerFor(input);
    if (!provider) return null;
    const result = await callStructured(provider, input.call);
    await recordClaudeUsage(db, shopId, feature, result);
    log("claude_assist.call", result.outcome === "error" ? "warn" : "info", {
      feature,
      model: result.model,
      outcome: result.outcome,
      errorCode: result.errorCode,
      inputTokens: result.usage.inputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      outputTokens: result.usage.outputTokens,
      costMicroUsd: result.costMicroUsd,
    });
    return result.value;
  } catch {
    // The database failing under an assist is not the assist's problem to
    // report: the feature carries on dark and the database error surfaces
    // wherever the page reads next.
    log("claude_assist.failed", "warn", { feature });
    return null;
  }
}
