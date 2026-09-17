/**
 * **Does this public URL name anything?** — the database half of the public
 * namespace's edge refusal (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * `src/lib/public-route-shape.ts` reads the pathname and says which question
 * to ask; this file asks it, from `src/proxy.ts`, before any static shell has
 * gone out. One indexed read for a shop-only route, a malformed segment or a
 * town, two for a route that names a course, a dive site or a departure inside
 * a shop. A closed-list miss (`absent`) never arrives here at all — it is not
 * in `PublicRouteQuery`, so nothing can hand it to a database.
 *
 * ## A town is the one shape with no shop over it
 *
 * `/dive/<town>` names no shop, so there is no frame to resolve (issue #765 is
 * about a diver on a dead storefront link) and no shop read to make: one
 * bounded probe answers the whole question. It costs a real read on an
 * anonymous, crawler-visible route that had none before, and the invariant is
 * what makes it unavoidable — there is no closed list of towns, only a
 * projection of `shops.region_slug`, so `/dive/not-a-town` passes every pattern
 * check there is and a shape-only refusal would have left the issue's own probe
 * answering 200 with every new unit test green (issue #1734). The probe is
 * `regionIsListed`, which carries `listedShopScope` and nothing else — the same
 * scope `listRegionShops` reads through, so the day a shop ticks Search listing
 * the edge and the page change their minds together.
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
 *   `courses/[slug]/page.tsx` serves an inactive course to a staff previewer —
 *   the flag is *reported* rather than applied, and who may see past it is
 *   settled one layer up (see "The one predicate the edge applies" below);
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
 * ## The one predicate the edge applies, and what it cost to get there
 *
 * A hidden course is the exception to the paragraph above, and it is worth
 * reading as an exception rather than as a second rule. Course slugs are minted
 * from a shared template catalogue, so leaving `is_active` entirely to the page
 * put the two cases on different status lines — 200 with the shop's refusal
 * streamed under it for a draft, 404 for a slug that never existed — and a
 * stranger swept a shop's namespace with a dozen guesses to learn which
 * unpublished drafts it held. `is_active` is the shop's own "not yet", and
 * nobody outside the shop is owed it.
 *
 * Every *cheap* way to close that is worse than the disclosure, which is why it
 * stood as an accepted cost for a while (issue #1735):
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
 * All three are the edge *guessing* who is reading. What closed it instead is
 * the previewer arriving carrying something the edge can check: the editor
 * mints a short-lived signed parameter where it already knows the reader is
 * this shop's live staff, and `coursePreviewIsValid`
 * (`src/lib/course-preview-gate.ts`) verifies it in `src/proxy.ts` with no
 * database read and no opinion about sessions at all. The capability is the
 * same grammar the waiver, recap and ready links use.
 *
 * So this file reports `hidden` and decides nothing. The proxy applies it, the
 * page keeps its own live per-shop `isLiveShopStaff` check, and a token in a
 * stranger's hands still renders them `notFound()` — the parameter buys one
 * thing, which is not being refused before the page is asked.
 *
 * **What it costs, stated plainly.** A staffer who bookmarked a hidden course's
 * public URL now meets a 404 there, because a bare URL carries no capability
 * and the edge cannot tell them from the reader who was guessing. They reach it
 * from the editor, which is where the Preview link lives. That is a real
 * narrowing of the rule this block opens with, and the only one: for this one
 * flag the edge does refuse what the page would have served, to a reader who
 * arrives without the thing that makes them legible.
 *
 * The departure bullet has the same shape and not the same cost: a trip id is a
 * random uuid, so there is no namespace to sweep, and `trips/[id]/page.tsx`
 * carries no `isPrivate` check at all — whoever holds the uuid already reads the
 * whole booking page, so the status line tells them strictly less than the page
 * does.
 */

import type { PublicRouteQuery } from "@/lib/public-route-shape";
import type { AppDb } from "./client";
import { getCourseBySlug } from "./courses";
import { getDiveSiteBySlug } from "./dive-sites";
import { regionIsListed } from "./regions";
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
  /**
   * The row is there, and the shop has it off its public site. Only a course
   * can answer true — it is `courses.is_active`, reported and not applied, so
   * the caller holding the capability decides (issue #1735).
   */
  readonly hidden: boolean;
};

const NOTHING: PublicRouteLookup = { exists: false, shopExists: false, hidden: false };

export async function publicRouteLookup(
  db: AppDb,
  shape: PublicRouteQuery,
): Promise<PublicRouteLookup> {
  // The one shape with no shop over it, so the one that skips the shop read:
  // `/dive/<town>` is DiveDay's own page and its refusal is DiveDay's own.
  if (shape.kind === "region")
    return { exists: await regionIsListed(db, shape.regionSlug), shopExists: false, hidden: false };
  const shopId = await shopIdBySlug(db, shape.shopSlug);
  if (!shopId) return NOTHING;
  switch (shape.kind) {
    // A segment that could never have been minted names nothing, and asking
    // Postgres about it would only be a slower way to learn that. The shop
    // read above is still made, and made first: it is what decides whose
    // refusal this is.
    case "malformed":
      return { exists: false, shopExists: true, hidden: false };
    case "shop":
      return { exists: true, shopExists: true, hidden: false };
    case "course": {
      // The page's own reader, unchanged and still carrying no `isActive`
      // predicate. The flag rides back beside the row rather than filtering it
      // out, because the reader who may see past it is the one holding a
      // capability this file knows nothing about.
      const course = await getCourseBySlug(db, shopId, shape.courseSlug);
      return {
        exists: course !== null,
        shopExists: true,
        hidden: course ? !course.isActive : false,
      };
    }
    case "site":
      return {
        exists: (await getDiveSiteBySlug(db, shopId, shape.siteSlug)) !== null,
        shopExists: true,
        hidden: false,
      };
    case "trip":
      return {
        exists: await tripExistsForShop(db, shopId, shape.tripId),
        shopExists: true,
        hidden: false,
      };
  }
}
