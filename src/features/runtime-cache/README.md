# runtime-cache

Runtime cache hit/miss measurement through `cacheStamp`, `cacheReadOutcome` and `reportCacheRead`. The index publishes the pure timing calculation and structured-log reporting helper. Clock evidence comes from runtime performance measurements. Browser Sentry, log shipping and App Router lifecycle APIs are separate concepts.

`shopRowsCacheGeneration` is a cache-key argument for a `"use cache"` scope computed from a shop's own rows; it is 0 in a deployment. `expireShopRowsCaches` starts a new generation, and only the e2e routes that rewrite a shop's rows call it (`/api/test/reset`, `/api/test/shop`).
