import type { Environment } from "./seam";

/**
 * **One answer to "is this the real thing?"** (issue #2781).
 *
 * The e2e harness switches a few product behaviors off the real path: a frozen
 * clock, open `/api/test/*` routes, bundled marine-life photo tiles. Each used
 * to spell its own predicate over `DATABASE_URL`, `NODE_ENV` and `DIVEDAY_E2E`,
 * and the spellings drifted: the tile swap had no `DATABASE_URL` guard at all.
 * This derives the answers once from those facts, so a module asks a question
 * and only this file knows how a harness is switched on.
 *
 * **Fail closed, one rule for every field:** whenever `DATABASE_URL` is set the
 * process is a real deployment and every harness field is off, whatever else is
 * set. A stray `DIVEDAY_E2E=1` or `DIVEDAY_CLOCK` left on a production project
 * changes nothing.
 *
 * Not named "rehearsal": that word is taken by rehearsal departures (ADR
 * 20261012-rehearsal-departures). The first modules on it are `clock.ts`,
 * `e2e-test-routes.ts` and `marine-life-tiles.ts`; the rest (`rate-limit.ts`,
 * the tide modules, `proxy.ts`, the cookie sites) still read the variables
 * themselves and move over under the same issue.
 *
 * Takes the environment as a parameter, defaulted to the live one, because the
 * answers must follow a test's stubbed variables; the record is frozen.
 */
export type RuntimeMode = Readonly<{
  /** `DATABASE_URL` is set: a real deployment, every harness field off. */
  realDatabase: boolean;
  /** The instant `DIVEDAY_CLOCK` freezes the application clock at, or null for the live clock. */
  frozenClockMs: number | null;
  /** `/api/test/*` may be reached at all (the bearer secret is still required on top). */
  testRoutesOpen: boolean;
  /** The e2e capture run: photo URLs are swapped for the committed tile files. */
  capturePhotos: boolean;
  /**
   * `DIVEDAY_DISABLE_EXTERNAL_HTTP` is honored: tide stations and predictions answer from
   * committed fixtures instead of fetching. Needs the harness opt-in or a non-production runtime.
   */
  syntheticFixtures: boolean;
  /**
   * The e2e harness may sign a `*.demo.invalid` account in with the demo password even when its
   * shop is not a demo (`privateShop({ demo: false })`, issue #2783). `is_demo` stays a visitor's
   * playground; fixture-ness is a property of the process.
   */
  fixtureSignIn: boolean;
  /** Cookies a flow sets itself (locale, demo, party return) carry `Secure`: production, not the e2e fleet. */
  secureCookies: boolean;
  /** Session cookies (proxy, Better Auth) carry `Secure`: everything except the e2e fleet's HTTP loopback. */
  secureSessionCookies: boolean;
  /** A memory-backed rate limiter in this process is worth a warning: production, not the e2e fleet. */
  warnMemoryRateLimit: boolean;
}>;

export function runtimeMode(env: Environment = process.env): RuntimeMode {
  const realDatabase = Boolean(env.DATABASE_URL);
  if (realDatabase) {
    return Object.freeze({
      realDatabase,
      frozenClockMs: null,
      testRoutesOpen: false,
      capturePhotos: false,
      syntheticFixtures: false,
      fixtureSignIn: false,
      secureCookies: true,
      secureSessionCookies: true,
      warnMemoryRateLimit: env.NODE_ENV === "production",
    });
  }
  const harness = env.DIVEDAY_E2E === "1";
  const clock = env.DIVEDAY_CLOCK ? Date.parse(env.DIVEDAY_CLOCK) : Number.NaN;
  return Object.freeze({
    realDatabase,
    frozenClockMs: Number.isNaN(clock) ? null : clock,
    // The e2e fleet serves a production build on purpose, so `DIVEDAY_E2E` is
    // what opens it there; outside a production runtime it is open by default.
    testRoutesOpen: env.NODE_ENV !== "production" || harness,
    capturePhotos: harness,
    syntheticFixtures:
      (harness || env.NODE_ENV !== "production") && env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1",
    fixtureSignIn: harness,
    secureCookies: env.NODE_ENV === "production" && !harness,
    secureSessionCookies: !harness,
    warnMemoryRateLimit: env.NODE_ENV === "production" && !harness,
  });
}
