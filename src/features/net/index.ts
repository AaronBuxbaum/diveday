/** net public contract. Internals are imported only within this module. */

export type { ResolvedAddress, ResolveHost } from "./public-address";
export {
  isPrivateAddressError,
  isUnsafeAddress,
  isUnsafeIPv4,
  isUnsafeIPv6,
  PRIVATE_ADDRESS_ERROR_CODE,
  PrivateAddressError,
  publicOnlyLookup,
  resolveHost,
} from "./public-address";
export type { PublicFetchOptions } from "./public-fetch";
export { fetchOverNode, publicOnlyFetch } from "./public-fetch";
