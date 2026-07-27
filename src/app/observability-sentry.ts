import * as Sentry from "@sentry/nextjs";
import { redactCapabilityUrl } from "./observability";

/**
 * Error monitoring (docs ADR 20260727-sentry-error-monitoring). A DSN isn't a
 * secret — Sentry's own design assumes it ships in client bundles — so one
 * env var covers both the server and the browser init below. Absent, this is
 * a no-op: every Sentry call becomes a no-client no-op, the same
 * degrades-to-"not configured" shape as the Resend notification provider.
 */
function sentryDsn(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
}

/**
 * Bearer-capability URLs (waivers/ready/recap/verify/reset-password tokens)
 * must never reach Sentry any more than they may reach Analytics or Speed
 * Insights — same redaction, same reasoning (docs/engineering/
 * capability-telemetry-runbook.md). Navigation breadcrumbs and XHR/fetch
 * breadcrumbs are the two shapes that can carry a raw token URL client-side.
 */
export function redactBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const data = breadcrumb.data;
  if (!data) return breadcrumb;
  if (breadcrumb.category === "navigation") {
    if (typeof data.from === "string") data.from = redactCapabilityUrl(data.from);
    if (typeof data.to === "string") data.to = redactCapabilityUrl(data.to);
  }
  if (
    (breadcrumb.category === "xhr" || breadcrumb.category === "fetch") &&
    typeof data.url === "string"
  ) {
    data.url = redactCapabilityUrl(data.url);
  }
  return breadcrumb;
}

/** Same redaction applied to the event's own request URL and referrer. */
export function redactEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) {
    event.request.url = redactCapabilityUrl(event.request.url);
  }
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "referer") headers[key] = redactCapabilityUrl(headers[key]);
    }
  }
  return event;
}

export function initSentry(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const dsn = sentryDsn(env);
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: env.NODE_ENV,
    // Errors only, not performance tracing or session replay — keeps this
    // well inside Sentry's free tier and inside the "keep costs down" ask
    // that motivated a hand-picked SDK over the full auto-instrumented setup.
    tracesSampleRate: 0,
    beforeSend: redactEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });
}

/** Wired to Next's `onRequestError` instrumentation hook — a no-op until `initSentry` has a DSN. */
export const onRequestError = Sentry.captureRequestError;
