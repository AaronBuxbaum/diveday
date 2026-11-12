/** Runtime cache hit/miss measurement; no framework lifecycle or transport dependencies. */
export {
  cacheReadOutcome,
  cacheStamp,
  expireShopRowsCaches,
  reportCacheRead,
  shopRowsCacheGeneration,
} from "./rules";
