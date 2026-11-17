import type { RollCallCheckpoint } from "@/lib/manifests";
import { shopPath } from "@/lib/staff-notices";

/** The trip phases that build buddy teams, beside Roll call itself. */
export type BuddySurface = "ready" | "checkin";

/**
 * Where a buddy-team act lands when it is done: the screen it was made from,
 * with the teams panel open, since a session of them is rarely one act (form
 * a team, add the third, form the next). Ends on a query, never a fragment:
 * a refusal appends `&buddyError=` to it.
 */
export function buddyActLandsAt(ctx: {
  shopSlug: string;
  tripId: string;
  checkpoint: RollCallCheckpoint;
  buddySurface?: BuddySurface;
}): string {
  if (ctx.buddySurface) {
    return `${shopPath(ctx.shopSlug, "trips", ctx.tripId)}?phase=${ctx.buddySurface}&buddies=open`;
  }
  // `checkpoint` is escaped rather than interpolated raw: it reaches these
  // actions as a bound argument like the slug, and one carrying `&` would
  // append query params of its own to the URL a notice is then added to.
  return `${shopPath(ctx.shopSlug, "trips", ctx.tripId, "manifest")}?checkpoint=${encodeURIComponent(ctx.checkpoint)}&buddies=open`;
}
