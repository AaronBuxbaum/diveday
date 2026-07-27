import { initSentry } from "@/app/observability-sentry";

// Client-side errors (docs ADR 20260727-sentry-error-monitoring) — a no-op
// until `NEXT_PUBLIC_SENTRY_DSN` is set, same as the server side.
initSentry();
