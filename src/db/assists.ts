import { and, eq, gt, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { e2eClaudeFixtureProvider } from "@/lib/assists/e2e-fixtures";
import {
  type AssistDarkReason,
  assistDarkReason,
  externalHttpDisabled,
  shopMonthlyCapMicroUsd,
} from "@/lib/claude/dark";
import {
  CLAUDE_MODELS,
  type ClaudeModel,
  MODEL_PRICES_MICRO_USD_PER_TOKEN,
} from "@/lib/claude/models";
import { type ClaudeProvider, claudeProviderFromEnv } from "@/lib/claude/provider";
import {
  CLAUDE_CALL_MAX_MS,
  callStructured,
  type StructuredCall,
  type StructuredResult,
} from "@/lib/claude/structured";
import { MINUTE_MS, nowDate } from "@/lib/clock";
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
 * **The cap holds under concurrency** (security review N3). Before a call is
 * sent, a short transaction takes a per-shop advisory lock, sums the month's
 * spend *including calls still in flight*, and writes the call's row as
 * `pending` carrying a reserved cost: the most the call could plausibly
 * cost ({@link reservedMicroUsd}). It refuses when the reservation would cross
 * the cap, or when {@link MAX_CALLS_IN_FLIGHT} calls for this shop are already
 * out. So N racing calls cannot all pass a check none of them has paid for
 * yet; the overshoot is bounded by how far a real call can exceed its
 * reservation, not by how many calls a client fires at once.
 *
 * After the call the row is settled to what the call actually cost. A row
 * that is never settled (the process died, the update failed) keeps its
 * reservation, so a lost row costs the shop its estimate rather than costing
 * DiveDay a free call (N6). A call that failed after Anthropic may have
 * billed it (timeout, dropped connection, 5xx) is charged at least its
 * reservation for the same reason.
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

/**
 * The browser fleet's canned provider for a shop a spec armed
 * (`src/lib/assists/e2e-fixtures.ts`), so a lit assist can be photographed.
 * Null outside the fleet's own server, so a deployment always takes the real
 * provider or none; a test's own provider always wins.
 */
function withE2eFixture(shopId: string, options: AssistOptions): AssistOptions {
  if (options.provider) return options;
  const provider = e2eClaudeFixtureProvider(shopId, options.env ?? process.env);
  return provider ? { ...options, provider } : options;
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
  given: AssistOptions = {},
): Promise<AssistDarkReason | null> {
  const options = withE2eFixture(shopId, given);
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
 * nothing. It never throws: an assist is never the reason a page fails, so a
 * read that throws (a database blip, a missing row) reads as dark and the
 * page renders the way it always did.
 */
export async function assistsAvailable(
  db: AppDb,
  shopId: string,
  options: AssistOptions = {},
): Promise<boolean> {
  try {
    return (await assistDarkReasonFor(db, shopId, options)) === null;
  } catch {
    return false;
  }
}

/** How many calls one shop may have out at once; a third waits for none and is refused. */
export const MAX_CALLS_IN_FLIGHT = 2;

/**
 * How long a `pending` row counts as in flight: the longest a call can run
 * (every turn it may resume, each at the provider's timeout and its one
 * retry), and a minute more. Past that, a row still pending is a call that
 * will never settle: it stops blocking the shop, and keeps charging its
 * reservation.
 */
export const IN_FLIGHT_WINDOW_MS = CLAUDE_CALL_MAX_MS + MINUTE_MS;

/** What a reservation assumes a call reads: a message and its context, or a few fetched pages. */
const RESERVED_INPUT_TOKENS = 20_000;
const RESERVED_TOOL_INPUT_TOKENS = 200_000;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 8_000;

/**
 * The most a call is expected to cost, held against the cap while it runs: a
 * full answer at `maxTokens`, plus a generous prompt (larger when it may use
 * server tools such as `web_fetch`, whose pages are re-sent on each turn).
 */
export function reservedMicroUsd(call: StructuredCall<z.ZodType>): number {
  const model: ClaudeModel = CLAUDE_MODELS[call.model];
  const price = MODEL_PRICES_MICRO_USD_PER_TOKEN[model];
  const input = Math.max(
    call.inputTokens ?? 0,
    call.tools?.length ? RESERVED_TOOL_INPUT_TOKENS : RESERVED_INPUT_TOKENS,
  );
  const output = call.maxTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  return Math.ceil(input * price.input + output * price.output);
}

/** An error code a provider may still have billed: the request reached it, the answer did not reach us. */
function mayHaveBilled(errorCode: string | undefined): boolean {
  return (
    errorCode === "timeout" ||
    errorCode === "connection" ||
    errorCode === "unknown" ||
    /^http_5\d\d$/.test(errorCode ?? "")
  );
}

/**
 * One reservation at a time per shop within this process. The advisory lock
 * below is what serialises reservations across server instances; it does
 * nothing between two transactions on one connection (an advisory lock is
 * re-entrant for its session, which is how a test database and a single
 * pooled connection both behave), so this chain covers that case.
 */
const reservationQueues = new Map<string, Promise<unknown>>();

function oneAtATime<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = reservationQueues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => undefined);
  reservationQueues.set(key, settled);
  void settled.then(() => {
    if (reservationQueues.get(key) === settled) reservationQueues.delete(key);
  });
  return next;
}

/**
 * Takes this shop's lock, and writes the call's `pending` row when its
 * reservation fits under the cap and the shop has room for another call in
 * flight. The row's id, or null when the call must not run.
 */
async function reserveClaudeCall(
  db: AppDb,
  input: { shopId: string; feature: string; model: ClaudeModel; reserve: number; now: Date },
  capMicroUsd: number,
): Promise<string | null> {
  return oneAtATime(input.shopId, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('claude_usage'), hashtext(${input.shopId}))`,
      );
      const { start, end } = periodBounds("calendar_month", input.now);
      const [month] = await tx
        .select({ total: sql<string | null>`sum(${claudeUsage.costMicroUsd})` })
        .from(claudeUsage)
        .where(
          and(
            eq(claudeUsage.shopId, input.shopId),
            gte(claudeUsage.createdAt, start),
            lt(claudeUsage.createdAt, end),
          ),
        );
      const [flying] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(claudeUsage)
        .where(
          and(
            eq(claudeUsage.shopId, input.shopId),
            eq(claudeUsage.outcome, "pending"),
            gt(claudeUsage.createdAt, new Date(input.now.getTime() - IN_FLIGHT_WINDOW_MS)),
          ),
        );
      const spent = Number(month?.total ?? 0);
      if (!Number.isFinite(spent) || spent + input.reserve > capMicroUsd) return null;
      if ((flying?.count ?? 0) >= MAX_CALLS_IN_FLIGHT) return null;
      const [row] = await tx
        .insert(claudeUsage)
        .values({
          shopId: input.shopId,
          feature: input.feature,
          model: input.model,
          outcome: "pending",
          costMicroUsd: input.reserve,
          createdAt: input.now,
        })
        .returning({ id: claudeUsage.id });
      return row?.id ?? null;
    }),
  );
}

/** Settles a call's row to what it actually cost. */
async function settleClaudeUsage(
  db: AppDb,
  usageId: string,
  reserve: number,
  result: StructuredResult<unknown>,
): Promise<void> {
  const billedFloor = result.outcome === "error" && mayHaveBilled(result.errorCode) ? reserve : 0;
  await db
    .update(claudeUsage)
    .set({
      outcome: result.outcome,
      errorCode: result.errorCode ?? null,
      inputTokens: result.usage.inputTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      outputTokens: result.usage.outputTokens,
      costMicroUsd: Math.max(result.costMicroUsd, billedFloor),
    })
    .where(eq(claudeUsage.id, usageId));
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
  return (await runAssistOutcome(db, input)).value;
}

/**
 * What became of one assist. `answered`: Claude answered, and `value` is what
 * survived validation (null for a refusal, an invalid or a low-confidence
 * answer), so asking again would cost the same for the same answer. `skipped`:
 * nothing was asked or nothing came back (dark, over the cap, two calls
 * already in flight, a provider error), so a later attempt may succeed.
 */
export type AssistOutcome<T> = { status: "answered" | "skipped"; value: T | null };

export async function runAssistOutcome<S extends z.ZodType>(
  db: AppDb,
  given: RunAssistInput<S>,
): Promise<AssistOutcome<z.infer<S>>> {
  const input = { ...given, ...withE2eFixture(given.shopId, given) };
  const skipped = { status: "skipped", value: null } as const;
  const { shopId, feature } = input;
  if (!FEATURE_KEY.test(feature)) {
    log("claude_assist.bad_feature_key", "error", {});
    return skipped;
  }
  try {
    const dark = await assistDarkReasonFor(db, shopId, input);
    if (dark) {
      log("claude_assist.dark", "info", { feature, reason: dark });
      return skipped;
    }
    const provider = providerFor(input);
    if (!provider) return skipped;
    const reserve = reservedMicroUsd(input.call);
    const usageId = await reserveClaudeCall(
      db,
      {
        shopId,
        feature,
        model: CLAUDE_MODELS[input.call.model],
        reserve,
        now: input.now ?? nowDate(),
      },
      shopMonthlyCapMicroUsd(input.env ?? process.env),
    );
    if (!usageId) {
      log("claude_assist.dark", "info", { feature, reason: "over_cap" });
      return skipped;
    }
    const result = await callStructured(provider, input.call);
    await settleClaudeUsage(db, usageId, reserve, result);
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
    return result.outcome === "error" ? skipped : { status: "answered", value: result.value };
  } catch {
    // The database failing under an assist is not the assist's problem to
    // report: the feature carries on dark and the database error surfaces
    // wherever the page reads next.
    log("claude_assist.failed", "warn", { feature });
    return skipped;
  }
}
