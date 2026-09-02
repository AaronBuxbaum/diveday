import { createHash } from "node:crypto";
import { z } from "zod";
import { nowMs } from "./clock";
import { log } from "./log";

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
 * Which store the default is, decided once at module load from the same env
 * vars `rateLimitStoreFromEnvironment` reads. Only ever used as a log/Sentry
 * tag: "the distributed store is failing" and "the in-process store is
 * failing" are entirely different operator errands (one is an Upstash/network
 * incident, the other is a bug in this file), and without the tag a store
 * error reads the same either way.
 */
const defaultStoreKind: "upstash" | "memory" = upstashConfigSchema.safeParse({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
}).success
  ? "upstash"
  : "memory";

/**
 * Minimum gap between two store-failure reports from one process.
 *
 * Every public write boundary in the app funnels through `checkRateLimit`, so
 * whatever breaks a store (Upstash down, a network partition, a bad response
 * shape) breaks it for *every* request at once — an undamped report would send
 * one Sentry event and one log line per request for as long as the incident
 * lasts, which buries the signal in its own volume and burns the Sentry quota
 * that everything else in the app shares. One report per minute per instance
 * is enough to see an incident start, and the report carries `swallowed` — how
 * many failures went unreported since the last one — so the *rate* survives
 * the damping even though the individual events don't.
 */
const STORE_ERROR_REPORT_INTERVAL_MS = 60_000;

/** Per-process damping state for the reporter below. */
const storeErrors = { lastReportedAt: Number.NEGATIVE_INFINITY, swallowed: 0 };

/**
 * The fail-open path's one job besides failing open: leave a trace.
 *
 * Deliberately says nothing about *which* key failed. `checkRateLimit`'s `key`
 * is by convention a `rateLimitKey()` hash, but nothing in the type system
 * makes it one — a future call site could pass a raw email or bearer token,
 * and a log line is exactly where that must never end up (CR-013's "no raw
 * token/medical/PII keys"). The store kind, the error's *name* (a code, not a
 * sentence — `src/lib` never logs prose), and the suppressed count are the
 * whole payload; Sentry gets the exception itself, which is where the detail
 * belongs.
 *
 * Sentry is imported lazily, only on the report that actually goes out: this
 * module is imported by every public write boundary and by `src/lib/auth.ts`,
 * and a static import would pull the Sentry SDK into all of them (and into
 * every unit test that touches one) to serve a path that should never run.
 *
 * The whole body is wrapped: observability failing must never become the
 * outage the fail-open policy exists to prevent.
 */
async function reportStoreFailure(error: unknown, store: RateLimitStore, now: number) {
  try {
    storeErrors.swallowed += 1;
    const sinceLastReport = now - storeErrors.lastReportedAt;
    // A `now` that moved backwards (a caller passing its own instant) reports
    // rather than silently suppressing until the clock catches up again.
    if (sinceLastReport >= 0 && sinceLastReport < STORE_ERROR_REPORT_INTERVAL_MS) return;
    const swallowed = storeErrors.swallowed;
    storeErrors.swallowed = 0;
    storeErrors.lastReportedAt = now;

    const kind = store === defaultStore ? defaultStoreKind : "injected";
    log("rate_limit.store_failed", "error", {
      store: kind,
      error: error instanceof Error ? error.name : typeof error,
      swallowed,
    });
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, {
      tags: { rate_limit_store: kind },
      extra: { swallowed_since_last_report: swallowed },
    });
  } catch {
    // Nothing to do about a broken reporter but keep the request moving.
  }
}

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
 *
 * Fail-open, but never *silent* (OPS-7): a store that is down means every
 * public write boundary in the app is unprotected, which is precisely the
 * state nobody may learn about from an attacker. The catch reports before it
 * allows — damped, awaited (an un-awaited report can be frozen the instant a
 * serverless response completes), and unable to throw.
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
  } catch (error) {
    await reportStoreFailure(error, store, now);
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
 *
 * **This object is the only source of truth for the numbers, and
 * docs/engineering/rate-limiting-runbook.md must agree with it.** That is not
 * a convention: a guard in `rate-limit.test.ts` parses every
 * `` `RATE_LIMITS.name` (N/window) `` in the runbook and fails on a figure
 * that drifts or an entry the runbook never mentions. The runbook's stale
 * "30/hour" for `capabilityAction` (raised to 60 in July) is what that guard
 * exists to prevent recurring — an operator reading a reassuring wrong number
 * during an incident is worse served than one reading nothing.
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
  /**
   * Self-registration from the shop's own QR, per IP. The public write with
   * the widest blast radius on this surface: it creates a person row.
   */
  selfRegisterByIp: perHour(10),
  /**
   * Self-registration, **per shop**.
   *
   * The bucket that has to exist separately: a global cap would let one shop's
   * QR — printed on a card in a busy lobby, or sprayed by one visitor — starve
   * every other shop's counter. Sized for a real dive-shop morning, where a
   * boat's worth of walk-ins registering back to back is the case this exists
   * to serve rather than the case it should throttle.
   */
  selfRegisterByShop: perHour(120),
  /**
   * Self-registration, per **recipient address**.
   *
   * The bucket `waiverLinkResendByBooking` and `declarationByPerson` already
   * exist for: neither of the two above is keyed on the person being *written
   * to*, so 10 submissions an hour aimed at one victim's inbox is 10 waiver
   * emails an hour carrying the shop's name — and, worse for the tenant, an
   * attacker can make a shop's SES identity send branded mail to addresses that
   * have no relationship with it at all.
   *
   * Following `declarationByPerson`'s shape: an empty bucket drops the *send*,
   * never the registration. The diver still goes on file; the shop can send the
   * release itself.
   */
  selfRegisterEmailByRecipient: perHour(3),
  /**
   * Contact-email confirmation links (issue #1288), per **shop** and per
   * **recipient address**. The settings form takes any address and the resend
   * control mints a fresh link each tap, and a demo shop's owner login is one
   * click away for anyone -- so without these, "Contact email" is a form that
   * sends branded DiveDay mail to an address of the attacker's choosing as
   * fast as they can tap. Three an hour is generous for the honest case (one
   * save, one resend when the first went to spam) and useless as a relay.
   * An empty bucket drops the *send*; the address is still saved.
   */
  contactConfirmationByShop: perHour(3),
  contactConfirmationByRecipient: perHour(3),
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
   * "Can't find your link?" requests (issue #723), per IP — the wider net,
   * same figure and the same reasoning as the password-reset request above:
   * this is the identical anonymous-capability-minting shape, one shop
   * namespace over.
   */
  findMyBookingByIp: perHour(5),
  /** Same request, per requested email — the narrow net. */
  findMyBookingByEmail: per15Min(3),
  /**
   * Consuming a verify/reset/invite/unsubscribe account token (the
   * confirm/submit actions on `/verify/[token]`, `/reset-password/[token]`,
   * `/invite/[token]`, and `/unsubscribe/[token]`), per IP. A personal link,
   * not a shared boat WiFi connection, so this is tighter than
   * `capabilityAction` — one person retrying their own link a few times is
   * plenty.
   */
  accountTokenAction: perHour(20),
  /** RFC 8058 unsubscribe POSTs, per capability token rather than shared provider IP. */
  oneClickUnsubscribe: perHour(10),
  /**
   * Second-factor attempts (TOTP or a recovery code), per signed-in account.
   *
   * Tighter than sign-in, because the caller is already holding a session: the
   * threat this bounds is a stolen cookie grinding the 1e6 codes in a 30-second
   * window, and one of the doors it opens -- disabling two-factor -- clears the
   * secret and every recovery hash on a single hit. Five is generous for a
   * person copying six digits off their phone.
   */
  secondFactorByAccount: per15Min(5),
  /** The same attempts per IP, so one attacker cannot fan out across accounts. */
  secondFactorByIp: per15Min(20),
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
  /**
   * Writing a self-declared certification onto a **named person's** record from
   * a public page, per that person rather than per IP.
   *
   * Two anonymous forms still do this: the shop-wide last-minute-deal list
   * (`joinLastMinuteListAction`) and a full trip's wait list (`joinWaitlist`).
   * Both take a name, an email and a rung, and hand it to
   * `recordSelfDeclaredCards`, which resolves the person by address. Both carry
   * a per-IP bucket already (`lastMinuteListJoin`, `waitlistJoin`, 10/hour
   * each), and a rotating set of addresses is exactly what a per-IP bucket
   * cannot see: somebody who knows a diver's name and email could otherwise
   * spray claims onto that diver's record. The default store is in-process per
   * instance unless Upstash is provisioned, and fails open on a store error, so
   * the effective per-IP ceiling across a serverless fleet is well above ten an
   * hour.
   *
   * **The key is the person written to, not the person submitting.** Keying on
   * the joiner would be no protection at all — a party names up to six people,
   * so a bucket on the submitter is cleared by putting the victim in seat two
   * with a fresh address each time. Only a key on the address a declaration is
   * *about* bounds how often one record can be written to. Shop-scoped, so a
   * spray at one shop cannot spend a diver's budget at another.
   *
   * **An empty bucket drops the declaration; it never refuses the join.** A
   * joiner must never be turned away because somebody else sprayed claims at
   * the address they typed, and the sign-up is the thing they actually came
   * for. A dropped claim is the same outcome a malformed one already gets
   * (`src/lib/dive-declaration.ts`: absent is a real answer).
   *
   * Five an hour, matching the resend buckets. A diver legitimately joins more
   * than one list in a sitting; a spray is orders of magnitude above that. A
   * join with no answer to the certification question spends nothing — there is
   * no claim to write, so there is no record to protect.
   *
   * What bounds the severity underneath this is the anti-displacement rule
   * (`src/db/self-declared-cards.ts`), which drops a claim rather than write it
   * over or beside any real evidence the shop holds. That is the primary
   * defence and it is unchanged; this is the net for divers the shop knows
   * nothing at all about, where the write is closer to spam than to tampering.
   */
  declarationByPerson: perHour(5),
  /**
   * The same net, for the same reason, on the trip-prep link (issue #850). A
   * separate bucket rather than a shared one so that a diver who has lost both
   * their waiver link and their prep link can rescue each once without one
   * spending the other's budget — they are two different inboxes' worth of mail
   * only in the sense that they are two different asks, and refusing the second
   * because the first was made would read as the feature being broken.
   */
  readinessLinkResendByBooking: perHour(5),
  /**
   * Core Web Vitals beacons to `/api/vitals`, per IP.
   *
   * Public and unauthenticated by necessity — the report comes from a diver's
   * browser before anything has identified them — and every accepted beacon
   * costs a CloudWatch log line and moves a p75. So this bounds two things at
   * once: ingest spend, and how far one source can drag a performance metric an
   * alarm watches.
   *
   * Loose on purpose. One beacon per page view, and a shop's whole staff can
   * sit behind one NAT address on a busy Saturday clicking through the roster
   * all morning; 300 an hour is five a minute from that entire building, which
   * no real use reaches and no useful attack fits inside.
   */
  webVitalsBeacon: perHour(300),
  /**
   * Content-Security-Policy violation reports, per IP (issue #718).
   *
   * Public and unauthenticated for the same structural reason as the vitals
   * beacon above — the browser posts it before anything has identified the
   * visitor — and with the same two costs: a CloudWatch log line each, and a
   * count an alarm watches.
   *
   * Tighter than the beacon, because the shapes differ. A vitals beacon is one
   * per page view; a violation report is *zero* per page view once the policy
   * is right, and while it is not, one page can emit a burst of them — one per
   * blocked subresource. A cap well above a single page's worst burst and well
   * below a useful firehose is the size worth having.
   */
  cspReport: perHour(120),
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
