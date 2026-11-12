import { browserSentry } from "@/app/sentry-client";
import { makeZodJitless } from "@/lib/zod-jitless";

// Zod's `new Function` probe was the `script-src` "eval" violation every staff
// page reported (see `makeZodJitless`). Off in the browser only — the server
// has no CSP and keeps the fast path. Must run before the first parse, which is
// why it lives here and not beside a schema.
makeZodJitless();

export function onRouterTransitionStart(href: string, navigationType: string) {
  browserSentry?.onRouterTransitionStart(href, navigationType);
}
