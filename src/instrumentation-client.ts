import * as Sentry from "@sentry/nextjs";
import { redactBreadcrumb, redactEvent } from "@/app/observability";

// Initialize client-side error reporting before React starts (docs/architecture/decisions/20260727-sentry-error-monitoring-q7fk2p.md).
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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
