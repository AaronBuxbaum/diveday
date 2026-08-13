import * as Sentry from "@sentry/nextjs";
import { redactBreadcrumb, redactEvent } from "@/app/observability";
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
  const [{ after }, { setFlushDeferrer }] = await Promise.all([
    import("next/server"),
    import("@/lib/observability"),
  ]);
  setFlushDeferrer((task) => {
    after(task);
  });

  // Validates the *effective* origin, not the raw variable: with the default
  // compiled in, an override is the only thing that can be malformed, and it
  // is still the thing that must fail the boot rather than mis-link.
  const { appHost, checkPublicHost } = await import("@/lib/notifications");
  const result = checkPublicHost(appHost(), process.env.NODE_ENV === "production");
  if (result.status === "invalid") {
    throw new Error(`Invalid APP_HOST configuration: ${result.reason}`);
  }

  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
      beforeSend: redactEvent,
      beforeBreadcrumb: redactBreadcrumb,
      enableLogs: true,
    });
  }
}

/** Server-side errors (docs ADR 20260727-sentry-error-monitoring) */
export const onRequestError = Sentry.captureRequestError;
