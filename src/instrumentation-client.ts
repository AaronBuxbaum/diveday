import { config as configureZod } from "zod/v4/core";
import { redactBreadcrumb, redactEvent, SENTRY_DATA_COLLECTION } from "@/app/observability";
import { deferSentry } from "@/lib/observability/sentry-browser";
import { SENTRY_DSN } from "@/lib/sentry-dsn";

// Zod compiles a faster object parser with `new Function`, and finds out whether
// it may by calling `new Function("")` inside a try/catch the first time any
// object schema parses. The catch swallows the throw, but the browser has
// already reported it: that probe was the `script-src` "eval" violation every
// staff page sent to /api/csp-report. Off in the browser only — the server has
// no CSP and keeps the fast path. Must run before the first parse, which is
// why it lives here and not beside a schema.
configureZod({ jitless: true });

/**
 * Client-side error reporting (docs/architecture/decisions/20260727-sentry-error-monitoring-q7fk2p.md),
 * loaded on idle rather than imported here: a static import put the SDK on
 * every route's first-load floor (code review 2026-10-13b, item 34). Errors
 * thrown before it arrives are kept and handed to it (`deferSentry`).
 */
function whenIdle(run: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    // The timeout bounds the wait on a page that is never idle.
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 1);
  }
}

const reporter =
  SENTRY_DSN && typeof window !== "undefined"
    ? deferSentry({
        load: () => import("@sentry/nextjs"),
        init: (Sentry) =>
          Sentry.init({
            dsn: SENTRY_DSN,
            environment: process.env.NODE_ENV,
            // Tracing is off and Session Replay is never configured here, so
            // both are unused. Sentry Logs has no switch since @sentry/nextjs
            // 11; nothing here calls `Sentry.logger`, so its flush timer never
            // arms.
            tracesSampleRate: 0,
            dataCollection: SENTRY_DATA_COLLECTION,
            beforeSend: redactEvent,
            beforeBreadcrumb: redactBreadcrumb,
          }),
        target: window,
        whenIdle,
      })
    : undefined;

export function onRouterTransitionStart(href: string, navigationType: string) {
  reporter?.onRouterTransitionStart(href, navigationType);
}
