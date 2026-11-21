# platform

Plumbing, not a shop concept. Request and render lifecycle, security headers, cron and webhook
gates, error reporting, caching, storage, the test harness's switches, and the undo and search
machinery every surface shares. A shop person would not name anything here; if they would, it
belongs in another area.

## Owns

- Requests and actions: `server-action.ts` (`defineAction`, `land`, the one way a staff mutation is
  written), `form-parse.ts`, `form-drafts.ts`, `navigation.ts`, `render-connection.ts`,
  `same-origin.ts`, `settle-with-limit.ts`, `undo.ts`, `undo-subjects.ts`, `search.ts`.
- Security: `content-security-policy.ts`, `security-headers.ts`, `csp-reports.ts`, `cron-auth.ts`,
  `cron-route.ts`, `webhook-events.ts`, `webhook-refusal.ts`, `sealed-secret-samples.ts`.
- Observability: `sentry-server.ts`, `sentry-browser.ts`, `sentry-dsn.ts`, `log-shipping/`,
  `health.ts`, `platform-status.ts`, `db-failure.ts`, `usage/`, `usage-alert-ledger.ts`.
- Caching, storage and network: `runtime-cache.ts`, `shops-cached.ts`, `shop-tick/`, `storage/`,
  `net/`, `address-lookup-aws.ts`.
- The device: `device-text-size.ts`, `home-screen-install.ts`.
- The test harness: `e2e-port.ts`, `e2e-test-routes/`, `test-clock.ts`.

## Invariants

- `defineAction` runs session, then every gate, then the form, then `run`, then one revalidate and
  redirect; every refusal throws. A notice code is spelled once, at its `land(…)`.
- `render-connection.ts` is for App Router server pages and layouts only; browser reporting and
  instrumentation never import it. `sentry-browser.ts` has no server or framework imports, since
  `src/instrumentation-client.ts` is a browser entrypoint. `sentry-server.ts` loads the SDK only
  when configured, and a failure never breaks the request.
- The e2e test routes stay closed outside the harness.
- `device-text-size.ts` can only increase the root size and leaves unsupported or failed readings
  alone; `home-screen-install.ts` treats installation as no evidence that an offline manifest is
  saved or fresh, and a failed preference read suppresses the row.
- `runtime-cache.ts`: `shopRowsCacheGeneration` is 0 in a deployment; only the e2e routes that
  rewrite a shop's rows (`/api/test/reset`, `/api/test/shop`) call `expireShopRowsCaches`.
