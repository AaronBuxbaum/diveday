# sentry-browser

Browser error reporting loaded on idle through `deferSentry`. The public contract is `index.ts`.

`rules.ts` owns bounded early-error buffering, deferred SDK startup and router-transition reporting. Its test drives the supplied loader, browser event target and idle scheduler.

This module has no runtime server or framework imports. `src/instrumentation-client.ts` is a browser entrypoint even without a `use client` directive; its import graph must stay browser safe. Server log shipping and server Sentry reporting belong to `observability`.
