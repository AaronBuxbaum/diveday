import { createHash } from "node:crypto";
import { z } from "zod";
import { nowMs } from "./clock";

/**
 * A shared per-source abuse-control seam for public write boundaries
 * (CR-013: onboarding, sign-in, recap uploads, wait-list joins, bookings,
 * and capability-token actions). Token bucket, not a fixed window, so a
 * burst up to `capacity` is allowed instantly and the rate then refills
 * continuously — no "everyone retries exactly at the window edge" thundering
 * herd.
 *
 * Provider-seam shaped like email/payments/SMS (docs/architecture/
 * overview.md): `RateLimitStore` is the swappable interface, `checkRateLimit`
 * is the only call sites should use, and a store is never allowed to turn
 * into an outage for legitimate traffic — see the fail-open policy below.
 * `RateLimitStore.take` may answer synchronously (the in-memory default) or
 * over the network (the distributed Upstash store below, ADR
 * 20260801-distributed-rate-limit-store) — `checkRateLimit` always awaits it.
 */

export type RateLimitConfig = {
  /** Burst size — requests allowed instantly before throttling kicks in. */
  capacity: number;
  /** Tokens restored per millisecond. */
  refillPerMs: number;
};

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export interface RateLimitStore {
  take(
    key: string,
    config: RateLimitConfig,
    now: number,
  ): RateLimitResult | Promise<RateLimitResult>;
}

type Bucket = { tokens: number; updatedAt: number };

/**
 * Caps how many distinct keys the in-memory store holds at once. Without a
 * bound, an attacker who can generate unlimited distinct keys (e.g. a fresh
 * IP per request behind a botnet) could grow this Map without limit — a
 * memory-exhaustion vector, not just a rate-limit bypass. On overflow the
 * oldest-inserted bucket is evicted (Map preserves insertion order); this is
 * an accepted, documented degrade under sustained high-cardinality attack,
 * not a silent one.
 */
const MAX_BUCKETS = 50_000;

/**
 * In-process token bucket — per server instance only. A multi-instance
 * deployment (Vercel serverless, multiple regions/functions) does not share
 * this state, so it bounds abuse per instance rather than globally; that is
 * an accepted, documented gap (see
 * docs/architecture/decisions/20260724-rate-limiting.md), not a silent one.
 * Swap in a distributed store (Redis/Upstash) behind the same
 * `RateLimitStore` interface if a global ceiling is ever required.
 */
export function inMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, Bucket>();
  return {
    take(key, config, now) {
      const existing = buckets.get(key);
      const elapsed = existing ? Math.max(0, now - existing.updatedAt) : 0;
      const tokens = existing
        ? Math.min(config.capacity, existing.tokens + elapsed * config.refillPerMs)
        : config.capacity;

      if (tokens < 1) {
        buckets.set(key, { tokens, updatedAt: now });
        const deficit = 1 - tokens;
        const retryAfterMs =
          config.refillPerMs > 0
            ? Math.ceil(deficit / config.refillPerMs)
            : Number.POSITIVE_INFINITY;
        return { allowed: false, retryAfterMs };
      }

      if (!existing && buckets.size >= MAX_BUCKETS) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
      buckets.set(key, { tokens: tokens - 1, updatedAt: now });
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

type Fetch = typeof fetch;
type RateLimitEnvironment = Readonly<Record<string, string | undefined>>;

const upstashConfigSchema = z.object({
  url: z.string().trim().url(),
  token: z.string().trim().min(1),
});

/**
 * Executed atomically by Redis via `EVAL` — the whole read/refill/decide/write
 * cycle happens server-side in one round trip, so two "instances" racing on
 * the same key can never both read a stale token count and both decide
 * "allowed" (the bug an unsynchronized read-then-write over HTTP would have).
 * `KEYS[1]` is the bucket key; `ARGV` is `capacity, refillPerMs, now`. Returns
 * `{allowed (0/1), tokensAfter}` — `tokensAfter` lets the caller compute
 * `retryAfterMs` without a second round trip.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local existing = redis.call("HMGET", key, "tokens", "updatedAt")
local tokens = capacity
local updatedAt = now
if existing[1] then
  tokens = tonumber(existing[1])
  updatedAt = tonumber(existing[2])
end

local elapsed = now - updatedAt
if elapsed < 0 then elapsed = 0 end
tokens = tokens + elapsed * refillPerMs
if tokens > capacity then tokens = capacity end

local allowed = 0
if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
end

redis.call("HSET", key, "tokens", tostring(tokens), "updatedAt", tostring(now))
-- Idle buckets expire instead of living forever — generous relative to every
-- configured window (15min-1hr), so this only ever resets a bucket to full
-- after it would legitimately have refilled anyway.
redis.call("PEXPIRE", key, 86400000)

return {allowed, tostring(tokens)}
`;

const upstashEvalResponseSchema = z.object({
  result: z.tuple([z.number(), z.string()]),
});

/**
 * Distributed token bucket over Upstash Redis's REST API — no SDK dependency,
 * matching this codebase's existing hand-rolled-fetch precedent for Stripe
 * webhooks and Vercel Blob (ADR 20260801-distributed-rate-limit-store). A
 * malformed/erroring response throws, which `checkRateLimit`'s fail-open
 * wrapper turns into `{ allowed: true }` rather than an outage.
 */
export function upstashRateLimitStore(
  config: { url: string; token: string },
  fetchImpl: Fetch = fetch,
): RateLimitStore {
  return {
    async take(key, rateLimitConfig, now) {
      const response = await fetchImpl(config.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify([
          "EVAL",
          TOKEN_BUCKET_SCRIPT,
          1,
          key,
          String(rateLimitConfig.capacity),
          String(rateLimitConfig.refillPerMs),
          String(now),
        ]),
      });
      if (!response.ok) throw new Error(`Upstash Redis responded ${response.status}`);
      const parsed = upstashEvalResponseSchema.parse(await response.json());
      const [allowed, tokensAfterRaw] = parsed.result;
      if (allowed === 1) return { allowed: true, retryAfterMs: 0 };
      const tokensAfter = Number(tokensAfterRaw);
      const deficit = 1 - tokensAfter;
      const retryAfterMs =
        rateLimitConfig.refillPerMs > 0
          ? Math.ceil(deficit / rateLimitConfig.refillPerMs)
          : Number.POSITIVE_INFINITY;
      return { allowed: false, retryAfterMs };
    },
  };
}

/**
 * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` absent (the default —
 * every deployment until one is provisioned) falls back to the in-memory
 * store, so dev/e2e/an unconfigured deployment stay zero-setup (ADR
 * 20260801-distributed-rate-limit-store).
 */
export function rateLimitStoreFromEnvironment(
  env: RateLimitEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): RateLimitStore {
  const config = upstashConfigSchema.safeParse({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return config.success ? upstashRateLimitStore(config.data, fetchImpl) : inMemoryRateLimitStore();
}

const defaultStore = rateLimitStoreFromEnvironment();

/**
 * The e2e fleet can run as few as one worker (a single shared server, a
 * single shared 127.0.0.1 "IP") replaying dozens of sign-ins/bookings across
 * unrelated spec files against one in-memory store — real throttling there
 * would fail tests for having no bug, only shared state. Mirrors the
 * DIVEDAY_CLOCK guard in src/lib/clock.ts exactly: opt-out only via an
 * explicit env var, and refused outright whenever a real database is
 * configured, so no stray env var can ever disable rate limiting in
 * production.
 */
function rateLimitDisabled(): boolean {
  if (process.env.DATABASE_URL) return false;
  return process.env.DIVEDAY_RATE_LIMIT_DISABLED === "1";
}

/**
 * Checks and consumes one token for `key` under `config`. Never throws — a
 * rate limiter that can 500 a legitimate request is worse than no limiter
 * (fail-open policy). Any store (in-memory or distributed) must uphold the
 * same contract: an internal store error returns `{ allowed: true, ... }`,
 * never a thrown error that would take down the caller. Async because the
 * distributed store above does a real network round trip; every call site is
 * already inside an async server action, route handler, or auth callback.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = nowMs(),
  store: RateLimitStore = defaultStore,
): Promise<RateLimitResult> {
  if (rateLimitDisabled()) return { allowed: true, retryAfterMs: 0 };
  try {
    return await store.take(key, config, now);
  } catch {
    return { allowed: true, retryAfterMs: 0 };
  }
}

/**
 * Hashes the key's parts so a raw bearer token, email address, or other
 * sensitive value is never held as a literal Map key or written to a log —
 * only its hash, which cannot be reversed into the original (CR-013's "no
 * raw token/medical/PII keys"). Not a secret-derivation function (no salt
 * needed): the goal is opacity of the in-memory key, not authentication.
 */
export function rateLimitKey(...parts: Array<string | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("\u0000"))
    .digest("hex");
}

/** Requests per hour, expressed as capacity + refill rate. */
function perHour(capacity: number): RateLimitConfig {
  return { capacity, refillPerMs: capacity / (60 * 60 * 1000) };
}

/** Requests per 15 minutes. */
function per15Min(capacity: number): RateLimitConfig {
  return { capacity, refillPerMs: capacity / (15 * 60 * 1000) };
}

/**
 * Named policies for every public write boundary CR-013 covers. Kept in one
 * place so the actual numbers are reviewable in one diff rather than
 * scattered across action files. Deliberately generous relative to normal
 * human use (a diver never legitimately re-books six times an hour) so a
 * real customer retrying after a typo is never the one who gets throttled.
 */
export const RATE_LIMITS = {
  /** Account + shop creation, per IP. */
  onboard: perHour(5),
  /**
   * "Try the live demo" mints a whole seeded demo shop, so throttle it per IP.
   * Generous (a curious visitor may reload a few times), but it stops one IP
   * from spraying seeded shops faster than the 7-day reaper clears them
   * (ADR 20260724-per-visitor-demo-shops).
   */
  demoCreate: perHour(10),
  /** Credentials sign-in attempts, per IP — the wider net. */
  signInByIp: per15Min(20),
  /** Credentials sign-in attempts, per attempted email — the narrow net. */
  signInByEmail: per15Min(8),
  /** Recap photo uploads, per capability token. */
  recapUploadByToken: perHour(10),
  /** Recap photo uploads, per IP — catches one visitor spamming many tokens. */
  recapUploadByIp: perHour(30),
  /**
   * Address suggestions from the settings card, per signed-in staff member.
   *
   * Every keystroke past the minimum length is a *billed* request to Amazon
   * Location on the shop's own account, so this bounds the spend rather than
   * any security boundary — the action is already owner/manager-gated. Sized
   * for the errand it serves: a shop sets its address roughly once, and even a
   * hesitant typist re-typing a long street a few times stays well inside it.
   */
  addressLookup: perHour(120),
  /** Public wait-list joins, per IP. */
  waitlistJoin: perHour(10),
  /** Course inquiry submissions from the public course page, per IP. */
  courseInquiry: perHour(10),
  /** Public last-minute-list joins, per IP. */
  lastMinuteListJoin: perHour(10),
  /** Starting a post-trip tip checkout, per recap token. */
  tipStart: perHour(10),
  /**
   * Leaving or revising a review, per recap token. A diver edits their own
   * review a handful of times at most; the unique index already caps them at
   * one row, so this bounds the write rate rather than the review count.
   */
  reviewSubmitByToken: perHour(10),
  /** Reviews, per IP — catches one visitor spraying many guessed recap tokens. */
  reviewSubmitByIp: perHour(30),
  /**
   * Self-cancelling a booking from the readiness link, per IP. Tighter than
   * the general `capabilityAction` bucket (60/hr) — this is an irreversible,
   * money-moving action, not a form save, so a burst of attempts is a signal
   * worth throttling harder even at the cost of a legitimate retry waiting.
   */
  bookingSelfCancel: perHour(5),
  /** Password-reset requests, per IP — the wider net. */
  passwordResetRequestByIp: perHour(5),
  /** Password-reset requests, per requested email — the narrow net. */
  passwordResetRequestByEmail: per15Min(3),
  /**
   * Consuming a verify/reset/invite account token (the confirm/submit
   * actions on `/verify/[token]`, `/reset-password/[token]`, and
   * `/invite/[token]`), per IP. A personal link, not a shared boat WiFi
   * connection, so this is tighter than `capabilityAction` — one person
   * retrying their own link a few times is plenty.
   */
  accountTokenAction: perHour(20),
  /** Public booking submissions, per IP. */
  booking: perHour(10),
  /**
   * Any write behind a booking capability token (readiness, waiver,
   * schedule-confirmation actions) — per IP, keyed by the action's shared
   * token-verification chokepoint so every action in that file inherits it.
   * A dock/boat WiFi's single shared IP can legitimately carry several
   * divers each spending multiple actions (save-draft, complete,
   * emergency-contact, fit, nitrox, pay) on a busy morning, so this is
   * deliberately looser than the other per-IP policies above (security
   * review finding, 2026-07-24) — 60, not 30.
   */
  capabilityAction: perHour(60),
  /**
   * Emailing a fresh waiver link from a dead one, per **booking** rather than
   * per IP or per token. The per-IP `capabilityAction` bucket above still
   * applies, but on its own it would let anyone holding a leaked stale URL
   * spray that diver's inbox from a rotating set of addresses.
   *
   * The key must be the booking, not the token that asked. Every reissue leaves
   * another dead token behind pointing at the same booking, so a per-token
   * ceiling silently multiplied: N old links for one diver meant N separate
   * 5/hr budgets aimed at one mailbox. The invariant is one budget per inbox —
   * five in an hour is far more than a diver who lost an email ever needs, and
   * that stays true however many stale URLs exist for their booking.
   */
  waiverLinkResendByBooking: perHour(5),
} as const satisfies Record<string, RateLimitConfig>;

/**
 * A single generic code for every rate-limit rejection in the app — never
 * reveals which dimension (IP vs. email vs. token) tripped, so it can't be
 * used to enumerate accounts or tokens.
 *
 * `src/lib` never picks a copy bundle (a caller on the staff side and a
 * caller on the diver side would otherwise need two different resolved
 * strings from one constant): this is a stable code, not rendered text.
 * Each caller looks it up in its own `Record<code, MessageKey>` against
 * whichever bundle its surface uses, the same as any other domain code.
 */
export const RATE_LIMIT_MESSAGE = "rate_limited";
