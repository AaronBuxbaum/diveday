# render-connection

App Router request/render lifecycle published through `index.ts`.

`connectionForRoute` awaits the request connection, then schedules the route's query report with Next.js `after`. The focused test preserves that ordering and layout fallback labels.

This contract is only for App Router server pages and layouts. It must not be re-exported by browser reporting or runtime instrumentation modules, which Next.js compiles outside App Router server-component contexts. Shared query timing primitives stay in `src/lib/observability`.
