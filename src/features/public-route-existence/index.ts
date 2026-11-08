/** public-route-existence public contract. Internals are imported only within this module. */
export type { PublicRouteLookup } from "./store";
export {
  forgetPublicRouteLookups,
  PUBLIC_ROUTE_LOOKUP_TTL_MS,
  publicRouteLookup,
  rememberedPublicRouteLookup,
} from "./store";
