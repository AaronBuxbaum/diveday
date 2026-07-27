// Client-side errors (docs ADR 20260727-sentry-error-monitoring-q7fk2p) — a
// *dynamic* import, deliberately: `NEXT_PUBLIC_SENTRY_DSN` is inlined at
// build time, so an unset DSN lets the bundler dead-code-eliminate this
// branch entirely, keeping the ~80 KB Sentry browser SDK out of the shared
// first-load bundle (docs/architecture/performance-budgets.md) until Sentry
// is actually configured. A static top-level import shipped it to every
// visitor regardless of whether error reporting was ever turned on.
if (process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) {
  import("@/app/observability-sentry").then(({ initSentry }) => initSentry());
}
