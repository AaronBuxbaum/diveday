import { timingSafeEqual } from "node:crypto";

/**
 * Shared guard for every `/api/test/*` route (`reset`, `seed-account-token`,
 * `seed-stripe-account`, `seed-last-minute-unsubscribe-token`,
 * `seed-courtesy-email-unsubscribe-token`). Two independent checks, both
 * required:
 *
 * 1. The original env-var predicate: never reachable with a real database
 *    configured, and outside a production runtime the harness must
 *    explicitly opt in via `DIVEDAY_E2E`.
 * 2. A `DIVEDAY_E2E_SECRET` bearer token, set by the Playwright harness
 *    (`playwright.config.ts`'s `use.extraHTTPHeaders` + `serverEnv`,
 *    `e2e/global-setup.ts`'s manual request context) and required — fails
 *    closed exactly like `CRON_SECRET` in `src/app/api/cron/reminders/route.ts`
 *    when unset — with no default value.
 *
 * (1) alone is pure configuration: one misconfigured staging deployment
 * (production build, `DIVEDAY_E2E=1` left set from a CI template, PGlite
 * fallback) turns `seed-account-token` — which mints a valid password-reset
 * token for any account by email — into instant account takeover. (2) closes
 * that gap the same way `CRON_SECRET` closes it for the cron endpoint:
 * config drift alone is no longer enough (security review finding,
 * docs/product/archive/specialist-optimization-audit-20260731.md §5).
 */
export function e2eTestRouteAuthorized(request: Request): boolean {
  const hasRealDatabase = Boolean(process.env.DATABASE_URL);
  const productionRuntime = process.env.NODE_ENV === "production";
  const e2eHarness = process.env.DIVEDAY_E2E === "1";
  if (hasRealDatabase || (productionRuntime && !e2eHarness)) return false;

  const secret = process.env.DIVEDAY_E2E_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const provided = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
