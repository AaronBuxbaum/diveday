import { config as configureZod } from "zod/v4/core";
import { browserSentry } from "@/app/sentry-client";

// Zod compiles a faster object parser with `new Function`, and finds out whether
// it may by calling `new Function("")` inside a try/catch the first time any
// object schema parses. The catch swallows the throw, but the browser has
// already reported it: that probe was the `script-src` "eval" violation every
// staff page sent to /api/csp-report. Off in the browser only — the server has
// no CSP and keeps the fast path. Must run before the first parse, which is
// why it lives here and not beside a schema.
configureZod({ jitless: true });

export function onRouterTransitionStart(href: string, navigationType: string) {
  browserSentry?.onRouterTransitionStart(href, navigationType);
}
