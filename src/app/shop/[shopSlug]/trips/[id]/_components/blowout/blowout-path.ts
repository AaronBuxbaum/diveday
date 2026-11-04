import { shopPath } from "@/lib/staff-notices";

/**
 * Where a departure's blow-out is worked: the departure itself in its blow-out
 * state. `shopPath` escapes each segment, so a client-supplied id cannot
 * rewrite the route it names.
 */
export function blowoutPath(shopSlug: string, tripId: string): string {
  return `${shopPath(shopSlug, "trips", tripId)}?blowout=1`;
}
