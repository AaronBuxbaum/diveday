import type * as SentrySdk from "@sentry/nextjs";
import { errorCauseTokens, errorClassToken } from "@/lib/error-token";
import { SENTRY_DSN } from "@/lib/sentry-dsn";

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
    return (await sdk())?.captureCheckIn(...args);
  },
};

/**
 * Report a failure to Sentry without its message (issue #2334). Sentry's
 * `beforeSend` (`redactEvent` in src/app/observability.ts) scrubs capability
 * URLs and headers, not exception text, and a handler's or a database's error
 * can quote the row it refused: a diver's name or email. So Sentry gets a
 * stand-in named `name` with the fixed `message`, the original's stack frames
 * (where it broke, not what it said), and as tags the caller's own plus the
 * original's class and, when it wraps one, its cause's class and code (a
 * SQLSTATE). The original is never attached as `cause`, which Sentry would
 * send in full.
 */
export async function reportScrubbedError(
  error: unknown,
  stand: { name: string; message: string; tags: Record<string, string> },
): Promise<void> {
  const scrubbed = new Error(stand.message);
  scrubbed.name = stand.name;
  if (error instanceof Error && error.stack) {
    const frames = error.stack.split("\n").filter((line) => /^\s+at /.test(line));
    scrubbed.stack = [`${scrubbed.name}: ${scrubbed.message}`, ...frames].join("\n");
  }
  const { causeName, causeCode } = errorCauseTokens(error);
  await sentry.captureException(scrubbed, {
    tags: {
      ...stand.tags,
      error_class: errorClassToken(error),
      // A database error wraps the driver's own: its class and SQLSTATE say
      // what failed without the parameters the outer message quotes.
      ...(causeName ? { cause_name: causeName } : {}),
      ...(causeCode ? { cause_code: causeCode } : {}),
    },
  });
}
