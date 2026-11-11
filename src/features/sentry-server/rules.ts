import type * as SentrySdk from "@sentry/nextjs";
import { SENTRY_DSN } from "@/features/sentry-dsn";

/**
 * **The Sentry calls a cron or webhook route makes, loaded on first use**
 * (code review 2026-10-13, item 28).
 *
 * Seventeen route files used to `import * as Sentry from "@sentry/nextjs"` at
 * the top, so every cold start of every cron evaluated the SDK and its
 * 1.2 MB server chunk before the route had decided anything — including the
 * runs that answer 401 to a missing bearer token, and every run in a build
 * with no DSN at all. `src/instrumentation.ts` already loads the SDK inside
 * `initSentry` and `onRequestError` only; this is the same shape for the
 * routes. With no DSN (`NEXT_PUBLIC_SENTRY_DSN=` in e2e and local builds) the
 * SDK is never imported and each call answers `undefined`.
 *
 * Every call is awaited by its caller: `captureCheckIn`'s id comes back from
 * the SDK, so a route that opens a monitor check-in waits the one import for
 * it. A load that fails reports nothing and throws nothing — a broken reporter
 * must never turn a pass that worked into a 500.
 *
 * `scripts/check-sentry-imports.mjs` refuses `import * as Sentry` under
 * `src/app`; a route reaches the SDK through this module.
 */
type Sdk = typeof SentrySdk;

let loading: Promise<Sdk | null> | undefined;

function sdk(): Promise<Sdk | null> {
  if (!SENTRY_DSN) return Promise.resolve(null);
  // A failed load is not remembered: the next report tries the import again,
  // so one transient failure does not silence the instance for its lifetime.
  loading ??= import("@sentry/nextjs").catch(() => {
    loading = undefined;
    return null;
  });
  return loading;
}

/**
 * **Which monitors may check in** (Sentry's free plan allows one Cron Monitor).
 * `SENTRY_CRON_MONITORS` is a comma-separated list of monitor slugs; set, every
 * other slug's check-in is skipped here, at the one place all of them pass, so
 * Sentry never sees a second monitor to refuse. Unset, every route checks in.
 * Failures still reach Sentry as errors and CloudWatch as `scan_failed`.
 */
function monitorAllowed(slug: string): boolean {
  const list = process.env.SENTRY_CRON_MONITORS?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return !list?.length || list.includes(slug);
}

export const sentry = {
  async captureException(
    ...args: Parameters<Sdk["captureException"]>
  ): Promise<string | undefined> {
    return (await sdk())?.captureException(...args);
  },
  async captureMessage(...args: Parameters<Sdk["captureMessage"]>): Promise<string | undefined> {
    return (await sdk())?.captureMessage(...args);
  },
  async captureCheckIn(...args: Parameters<Sdk["captureCheckIn"]>): Promise<string | undefined> {
    if (!monitorAllowed(args[0].monitorSlug)) return undefined;
    return (await sdk())?.captureCheckIn(...args);
  },
};
