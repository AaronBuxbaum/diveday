import { configuredValue } from "@/lib/configured";

/**
 * DiveDay's Sentry DSN (ADR 20260727-sentry-error-monitoring-q7fk2p).
 *
 * A DSN is not a secret -- it is designed to ship inside client bundles -- so
 * this one is compiled in rather than deployed as configuration, and the same
 * value covers server and browser.
 *
 * **The `process.env.NEXT_PUBLIC_SENTRY_DSN` read below must stay written out
 * literally.** Next replaces that exact member expression with a string at
 * build time; reached through a variable key or a spread `env` object it is
 * not substituted, and the browser bundle would silently see `undefined` and
 * report nothing. That is why this module exists rather than the override
 * being resolved inside `configuredValue`'s callers the way `APP_HOST`'s is.
 *
 * `NEXT_PUBLIC_SENTRY_DSN=` (set, empty) switches reporting off, which is what
 * `pnpm e2e:build` does so the test suite never reports to the real project.
 */
export const SENTRY_DSN = configuredValue(
  process.env.NEXT_PUBLIC_SENTRY_DSN,
  "https://65d405fac65b4705122fac6512beae95@o4511809221427200.ingest.us.sentry.io/4511809222672384",
);
