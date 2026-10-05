import * as Sentry from "@sentry/nextjs";
import { config as configureZod } from "zod/v4/core";
import { redactBreadcrumb, redactEvent } from "@/app/observability";
import { SENTRY_DSN } from "@/lib/sentry-dsn";

// Zod compiles a faster object parser with `new Function`, and finds out whether
// it may by calling `new Function("")` inside a try/catch the first time any
// object schema parses. The catch swallows the throw, but the browser has
// already reported it: that probe was the `script-src` "eval" violation every
// staff page sent to /api/csp-report. Off in the browser only — the server has
// no CSP and keeps the fast path. Must run before the first parse, which is
// why it lives here and not beside a schema.
configureZod({ jitless: true });

// Initialize client-side error reporting before React starts (docs/architecture/decisions/20260727-sentry-error-monitoring-q7fk2p.md).
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,
    // Tracing is off and Session Replay is never configured here, so both are
    // unused. Neither currently shrinks the shared first-load bundle under
    // this app's Turbopack build — see the `bundleSizeOptimizations` comment
    // in next.config.ts for why — but turning them off is still the correct,
    // forward-compatible config. Sentry Logs has no switch since
    // @sentry/nextjs 11; nothing here calls `Sentry.logger`, so its flush
    // timer never arms.
    tracesSampleRate: 0,
    beforeSend: redactEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
