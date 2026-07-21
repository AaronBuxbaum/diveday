/**
 * The application clock. Every server-side read of "now" — for logic or for
 * rendering — goes through here instead of calling `new Date()` / `Date.now()`
 * directly, so a harness can freeze it.
 *
 * Why this exists: the demo seed is clock-anchored (one trip always sails
 * *today*, cert expiries are relative to now) and dozens of surfaces render
 * relative time. Against a live wall clock those surfaces move every run —
 * the Today queue reorders as a trip crosses from upcoming to sailed, a
 * departure's rounded slot advances every half hour, dates roll at midnight —
 * which makes visual-regression baselines (Argos) diff on nothing but the
 * clock. Masking the moving text never fixed the layout shifts underneath it.
 * A single frozen instant, shared by the seed and every render, makes the
 * whole surface pixel-identical on every run.
 *
 * Production is unaffected. `DIVEDAY_CLOCK` is set only by the e2e harness
 * (playwright.config.ts). When it is unset — every real deployment, `pnpm
 * dev`, unit tests that don't opt in — `nowDate()` is exactly `new Date()` and
 * `nowMs()` is exactly `Date.now()`, byte for byte. As a second guard the
 * override is refused whenever a real database is configured, so no stray env
 * var can ever freeze a production clock.
 *
 * In the browser bundle `process.env.DIVEDAY_CLOCK` inlines to `undefined`
 * (it is not `NEXT_PUBLIC_*`), so client code that imports this module always
 * gets the live clock — there is no half-frozen client/server state.
 *
 * Unit tests should keep passing an explicit `now` to domain functions; this
 * module is the default those parameters fall back to, not a replacement for
 * dependency-injecting time where a test needs to control it precisely.
 */

/** Parse `DIVEDAY_CLOCK` into a millisecond instant, or null to use the live clock. */
function frozenMs(): number | null {
  const raw = process.env.DIVEDAY_CLOCK;
  if (!raw) return null;
  // A configured database is a real deployment; never let an env var freeze a
  // production clock, whatever else is set. Mirrors the reset-route guard.
  if (process.env.DATABASE_URL) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Milliseconds since the epoch — frozen under the e2e harness, else `Date.now()`. */
export function nowMs(): number {
  return frozenMs() ?? Date.now();
}

/** The current instant — frozen under the e2e harness, else `new Date()`. */
export function nowDate(): Date {
  return new Date(nowMs());
}
