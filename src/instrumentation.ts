import * as Sentry from "@sentry/nextjs";
import { redactBreadcrumb, redactEvent } from "@/app/observability";
import { checkPublicHost } from "@/lib/notifications";

/**
 * Runs once per server instance before it accepts requests. APP_HOST is
 * optional (many features degrade to "not configured" without it), but a
 * *set* value that is malformed (wrong scheme, embedded credentials, a
 * path/query/fragment) is a deploy-config bug — fail loudly here rather than
 * silently mis-linking waiver/readiness/recap tokens or the Stripe callback.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const result = checkPublicHost(process.env.APP_HOST, process.env.NODE_ENV === "production");
  if (result.status === "invalid") {
    throw new Error(`Invalid APP_HOST configuration: ${result.reason}`);
  }

  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
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
