import { timingSafeEqual } from "node:crypto";
import { claudeFixturesArmed } from "./assists/e2e-fixtures";

/**
 * Shared guard for every `/api/test/*` route (`reset`, `seed-account-token`,
 * `seed-stripe-account`, `seed-interest-unsubscribe-token`,
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
  // Read before any refusal: under Cache Components, reading the request is
  // what keeps a `GET` route (`email-previews`) from being prerendered at
  // build time, where no secret is set and a baked-in 404 is the result.
  const provided = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  const hasRealDatabase = Boolean(process.env.DATABASE_URL);
  const productionRuntime = process.env.NODE_ENV === "production";
  const e2eHarness = process.env.DIVEDAY_E2E === "1";
  if (hasRealDatabase || (productionRuntime && !e2eHarness)) return false;

  const secret = process.env.DIVEDAY_E2E_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/**
 * **The one refusal every `/api/test/*` route answers with** (issue #2751),
 * whichever check refused: a closed harness gate, a real shop, or no shop at
 * all. One shape, so a caller cannot tell from the answer which of them it
 * failed, and a real tenant's slug reads exactly like one that does not exist.
 */
export function testRouteRefused(): Response {
  return Response.json({ error: "not_available" }, { status: 404 });
}

/** What `requireDemoTenant` hands back: the demo shop, or the one refusal. */
export type DemoTenant<Shop> = { ok: true; shop: Shop } | { ok: false; response: Response };

/**
 * **The one demo-fixture gate** (issue #2751): a fixture route writes only to
 * a demo tenant, never to a real shop, whatever slug it was handed. Checks the
 * harness gate again (`e2eTestRouteAuthorized`) before `findShop` runs, so no
 * route can reach the lookup through this gate without it, then refuses a
 * missing shop and any shop whose `isDemo` is not exactly `true`, with
 * `testRouteRefused`.
 *
 * One exception, and it is still a demo tenant: a shop this server armed
 * through `/api/test/claude-fixtures`. Arming takes a demo shop and clears its
 * flag so the assists light up (`claudeFixturesArmed`), and a spec drives that
 * shop's inbox while it is armed; disarming sets the flag back.
 *
 * `findShop` is the caller's lookup (`getShopBySlug` on its own database),
 * because `src/lib` takes only types from `src/db`. Sign-in's demo bypass
 * (`demoBypassAccepted`) keeps its own gate and never reads this one.
 */
export async function requireDemoTenant<Shop extends { id: string; isDemo: boolean }>(
  request: Request,
  findShop: () => Promise<Shop | null | undefined>,
): Promise<DemoTenant<Shop>> {
  if (!e2eTestRouteAuthorized(request)) return { ok: false, response: testRouteRefused() };
  const shop = await findShop();
  if (!shop) return { ok: false, response: testRouteRefused() };
  if (shop.isDemo !== true && !claudeFixturesArmed(shop.id)) {
    return { ok: false, response: testRouteRefused() };
  }
  return { ok: true, shop };
}
