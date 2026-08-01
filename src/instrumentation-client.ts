import * as Sentry from "@sentry/nextjs";
import { redactBreadcrumb, redactEvent } from "@/app/observability";

// Initialize client-side error reporting before React starts (docs/architecture/decisions/20260727-sentry-error-monitoring-q7fk2p.md).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    // Tracing is off and Session Replay is never configured here, so both are
    // unused; `enableLogs` (Sentry Logs, distinct from SDK debug logging) was
    // also unused and is dropped. None of the three currently shrink the
    // shared first-load bundle under this app's Turbopack build — see the
    // `bundleSizeOptimizations` comment in next.config.ts for why — but
    // turning them off is still the correct, forward-compatible config, and
    // `enableLogs: false` (the default) also stops an unused periodic
    // log-flush timer at runtime.
    tracesSampleRate: 0,
    beforeSend: redactEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
