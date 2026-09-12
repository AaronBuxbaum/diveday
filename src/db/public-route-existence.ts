/**
 * **Does this `/s/**` URL name anything?** — the database half of the public
 * namespace's edge refusal (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * `src/lib/public-route-shape.ts` reads the pathname and says which question
 * to ask; this file asks it, from `src/proxy.ts`, before any static shell has
 * gone out. One indexed read for a shop-only route or a malformed segment, two
 * for a route that names a course, a dive site or a departure inside a shop.
 *
 * ## Two answers, one shop read
 *
 * A refusal is framed as the shop the URL sat under, because a diver whose
 * link died is owed that shop's own 404 and not DiveDay's sales page (issue
 * #765). So the proxy needs a second fact — is that shop real? — and it used
 * to get it by calling this function again with `{ kind: "shop" }`, re-asking
 * the question the lookup below opens with. A dead URL under a live shop cost
 * three reads where two do, unauthenticated, on a pool capped at five
 * connections per instance, and a dead URL is the one request nobody
 * legitimate is making. Both facts now ride back on the one read.
 *
 * That is also why a malformed segment, which needs no query to be refused,
 * still pays for the shop probe: the read is not asking whether the segment
 * names a row, it is asking whose refusal the diver is about to read.
 *
 * ## The invariant, applied to predicates
 *
 * The rule and the reason behind it are stated once, on `publicRouteShape` —
 * **the edge may never refuse what the page would have served.** There it
 * governs which segments are judged by shape; here it governs which predicates
 * a lookup is allowed to carry. So every reader below is the *page's own*
 * reader, not a hand-written join that could forget a tenant scope or a
 * soft-delete predicate, and every "should this be visible?" question is
 * deliberately left where it already lives, in the page:
 *
 * - a course is looked up without `isActive`, because
 *   `courses/[slug]/page.tsx` serves an inactive course to a staff previewer;
 * - a departure is looked up without status and without `isPrivate`, because a
 *   cancelled one gets its own soft landing at 200 and a shop with the boat
 *   line switched off answers `notFound()` on purpose — but *with* `liveTrip()`,
 *   because every public reader of a departure carries it and 404s a removed
 *   one anyway, so the filter matches the page rather than overruling it
 *   (`tripExistsForShop` states the whole of that reasoning);
 * - a shop that opted out of search listing is still a shop — only
 *   `availability.json` and the year card refuse it, and both do so themselves.
 *
 * Every row this file finds still meets its page's own `notFound()` a moment
 * later. It only removes the cases where there was never a row at all.
 *
 * ## What the course bullet costs, and why that is the price
 *
 * Leaving `isActive` to the page means the status line separates a course a
 * shop has hidden (200, with the page's refusal streamed under the shell) from
 * one that never existed (404, decided here). Course slugs are minted from a
 * shared template catalogue, so a stranger sweeps a shop's namespace with a
 * dozen guesses and learns which unpublished drafts it holds — and `is_active`
 * is the shop's own "not yet". That is a real disclosure, accepted rather than
 * missed, because every way to close it at this layer costs more than it buys:
 *
 * - a refusal keyed on "no session cookie" is undone by one forged `Cookie:`
 *   header — better-auth's `getSessionCookie` returns whatever string sits under
 *   the cookie name and verifies nothing — so it would deter a crawler and not
 *   the reader who is probing;
 * - the snapshot `getCookieCache` decrypts is sound about what it holds, but it
 *   is a *cache*, five minutes wide (`src/lib/auth.ts`), and `authGateResponse`
 *   already declines to read a cold one as "signed out" for this exact reason:
 *   a staffer back from lunch tapping Preview holds a live session and no
 *   readable snapshot, and would meet a hard 404 on their own shop's course;
 * - that snapshot names one shop while staff roles are per-shop
 *   (`loadActiveStaffRoles`), so even a warm one is not a sound "not staff
 *   here" either.
 *
 * The page's check is live and per-shop (`isLiveShopStaff`, issue #966) and the
 * edge has no honest way to be both. Closing this wants the previewer to arrive
 * carrying something the edge can verify, not a cheaper guess at who is reading
 * (issue #1735).
 *
 * The departure bullet has the same shape and not the same cost: a trip id is a
 * random uuid, so there is no namespace to sweep, and `trips/[id]/page.tsx`
 * carries no `isPrivate` check at all — whoever holds the uuid already reads the
 * whole booking page, so the status line tells them strictly less than the page
 * does.
 */

import type { PublicRouteShape } from "@/lib/public-route-shape";
import type { AppDb } from "./client";
import { getCourseBySlug } from "./courses";
import { getDiveSiteBySlug } from "./dive-sites";
import { shopIdBySlug } from "./shops";
import { tripExistsForShop } from "./trips-record";

export type PublicRouteLookup = {
  /** Does the URL name a row? `false` is the refusal. */
  readonly exists: boolean;
  /**
   * Is the shop the URL sat under a real shop? Only the refusal path reads
   * this, and only to frame the 404 as that shop's (issue #765).
   */
  readonly shopExists: boolean;
};

const NOTHING: PublicRouteLookup = { exists: false, shopExists: false };

export async function publicRouteLookup(
  db: AppDb,
  shape: PublicRouteShape,
): Promise<PublicRouteLookup> {
  const shopId = await shopIdBySlug(db, shape.shopSlug);
  if (!shopId) return NOTHING;
  switch (shape.kind) {
    // A segment that could never have been minted names nothing, and asking
    // Postgres about it would only be a slower way to learn that. The shop
    // read above is still made, and made first: it is what decides whose
    // refusal this is.
    case "malformed":
      return { exists: false, shopExists: true };
    case "shop":
      return { exists: true, shopExists: true };
    case "course":
      return {
        exists: (await getCourseBySlug(db, shopId, shape.courseSlug)) !== null,
        shopExists: true,
      };
    case "site":
      return {
        exists: (await getDiveSiteBySlug(db, shopId, shape.siteSlug)) !== null,
        shopExists: true,
      };
    case "trip":
      return { exists: await tripExistsForShop(db, shopId, shape.tripId), shopExists: true };
  }
}
