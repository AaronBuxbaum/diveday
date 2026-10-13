import type { captureRequestError } from "@sentry/nextjs";
import { SENTRY_DSN } from "@/lib/sentry-dsn";

/**
 * Runs once per server instance before it accepts requests. APP_HOST is
 * optional (many features degrade to "not configured" without it), but a
 * *set* value that is malformed (wrong scheme, embedded credentials, a
 * path/query/fragment) is a deploy-config bug — fail loudly here rather than
 * silently mis-linking waiver/readiness/recap tokens or the Stripe callback.
 *
 * `checkPublicHost` is imported dynamically, not at module scope: this file
 * is compiled for both the Node and Edge instrumentation entry points, and
 * `@/lib/notifications` transitively reaches `@/lib/waivers`'s `node:crypto`
 * usage — a static import would pull that into the Edge bundle even though
 * the runtime guard below means it never actually runs there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Structured log lines ship to CloudWatch after the response rather than
  // during it (ADR 20260806-cloudwatch-log-shipping). `after()` is installed
  // from here rather than imported by the shipper because `src/lib` is
  // framework-free by rule, and because this is the one file that already runs
  // exactly once per server instance. Node runtime only: the Edge entry point
  // reaches this function above and returns.
  const [{ after }, { recordLogLine, setFlushDeferrer }, { setLogSink }] = await Promise.all([
    import("next/server"),
    import("@/lib/observability"),
    import("@/lib/log"),
  ]);
  setFlushDeferrer((task) => {
    after(task);
  });
  // And the shipper itself, for the same reason one line up. `src/lib/log.ts`
  // used to import `recordLogLine` directly, which put
  // `@aws-sdk/client-cloudwatch-logs` in the browser: `src/i18n/on-error.ts` is
  // the ICU error handler every translator carries, so every Client Component
  // that reads copy reached the shipper, and Turbopack browserified it into
  // 93.7 KB gzip of chunks the offline-manifest service worker then cached.
  // Nothing was lost by inverting it — a browser has no CloudWatch credentials,
  // so that code returned on its first config read wherever it landed.
  setLogSink(recordLogLine);

  // Validates the *effective* origin, not the raw variable: with the default
  // compiled in, an override is the only thing that can be malformed, and it
  // is still the thing that must fail the boot rather than mis-link.
  const { appHost, checkPublicHost } = await import("@/lib/notifications");
  const result = checkPublicHost(appHost(), process.env.NODE_ENV === "production");
  if (result.status === "invalid") {
    throw new Error(`Invalid APP_HOST configuration: ${result.reason}`);
  }

  if (SENTRY_DSN) await initSentry(SENTRY_DSN);
}

/**
 * **Sentry on the server, as much of it as this app uses** (code review
 * 2026-10-11, item 22). Errors only: `tracesSampleRate` is 0, so none of the
 * SDK's OpenTelemetry instrumentation (HTTP, fetch, the frameworks), console
 * breadcrumbs, local variables, process sessions or module lists has anything
 * to do here but cost a cold start. `defaultIntegrations: false` and the list
 * below are what `onRequestError` and the crons' `captureException`,
 * `captureMessage` and `captureCheckIn` actually lean on — none of the three
 * needs an integration of its own.
 *
 * Imported only when a DSN is set (`NEXT_PUBLIC_SENTRY_DSN=` empty switches it
 * off, as `pnpm e2e:build` does), and from here rather than at module scope:
 * this module is in every server entry's graph, and a static import put the
 * SDK's runtime in the two largest server chunks of every route.
 */
async function initSentry(dsn: string) {
  const [Sentry, { redactBreadcrumb, redactEvent, SENTRY_DATA_COLLECTION }] = await Promise.all([
    import("@sentry/nextjs"),
    import("@/app/observability"),
  ]);
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeSend: redactEvent,
    beforeBreadcrumb: redactBreadcrumb,
    defaultIntegrations: false,
    integrations: [
      // Which events are worth keeping, and how they read.
      Sentry.eventFiltersIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      // The request an error happened in — URL and query redacted by `redactEvent`.
      Sentry.requestDataIntegration(),
      // A throw nothing caught, which `onRequestError` never sees.
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      // Source lines around each frame, and the runtime it ran on.
      Sentry.contextLinesIntegration(),
      Sentry.nodeContextIntegration(),
    ],
  });
}

/**
 * Server-side errors (docs ADR 20260727-sentry-error-monitoring):
 * `captureRequestError`, reached the same lazy way, and nothing at all when no
 * DSN is set — there is no client to report to.
 */
export async function onRequestError(
  ...args: Parameters<typeof captureRequestError>
): Promise<void> {
  if (!SENTRY_DSN) return;
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
}
