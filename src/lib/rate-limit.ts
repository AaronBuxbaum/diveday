import { createHash } from "node:crypto";
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
 */

export type RateLimitConfig = {
  /** Burst size — requests allowed instantly before throttling kicks in. */
  capacity: number;
  /** Tokens restored per millisecond. */
  refillPerMs: number;
};

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export interface RateLimitStore {
  take(key: string, config: RateLimitConfig, now: number): RateLimitResult;
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

const defaultStore = inMemoryRateLimitStore();

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
 * (fail-open policy). Any future distributed store must uphold the same
 * contract: an internal store error returns `{ allowed: true, ... }`, never
 * a thrown error that would take down the caller.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = nowMs(),
  store: RateLimitStore = defaultStore,
): RateLimitResult {
  if (rateLimitDisabled()) return { allowed: true, retryAfterMs: 0 };
  try {
    return store.take(key, config, now);
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
  /** Public wait-list joins, per IP. */
  waitlistJoin: perHour(10),
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
} as const satisfies Record<string, RateLimitConfig>;

/** A single generic message for every rate-limit rejection in the app — never reveals which dimension (IP vs. email vs. token) tripped, so it can't be used to enumerate accounts or tokens. */
export const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";
