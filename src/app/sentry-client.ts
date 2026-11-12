import {
  redactBreadcrumb,
  redactEvent,
  SENTRY_DATA_COLLECTION,
} from "@/app/observability";
import { deferSentry } from "@/features/sentry-browser";
import { SENTRY_DSN } from "@/features/sentry-dsn";

/** Start the SDK on idle, or immediately when the root error boundary needs it. */
function whenIdle(run: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 1);
  }
}

export const browserSentry =
  SENTRY_DSN && typeof window !== "undefined"
    ? deferSentry({
        load: () => import("./sentry-browser-sdk"),
        init: (Sentry) =>
          Sentry.init({
            dsn: SENTRY_DSN,
            environment: process.env.NODE_ENV,
            tracesSampleRate: 0,
            dataCollection: SENTRY_DATA_COLLECTION,
            // CloudWatch RUM logs a failed Cognito exchange (offline, flaky
            // network, ad blocker) as an error; it is telemetry failing, not
            // the app.
            ignoreErrors: [/^CWR:/],
            beforeSend: redactEvent,
            beforeBreadcrumb: redactBreadcrumb,
          }),
        target: window,
        whenIdle,
      })
    : undefined;
