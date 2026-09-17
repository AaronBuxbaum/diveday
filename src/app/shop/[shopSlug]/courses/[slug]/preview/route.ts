import { getCourseBySlug } from "@/db/courses";
import { COURSE_PREVIEW_PARAM, signCoursePreview } from "@/lib/course-preview-gate";
import { publicCoursePath } from "@/lib/public-routes";
import { isLiveShopStaff, requireShopSurface } from "@/lib/session";

/**
 * **Where a course preview is minted**, and the only place it is (issue #1735).
 *
 * A course the shop has hidden answers 404 at the edge now, because leaving
 * `is_active` to the page put a draft on 200 and a slug that never existed on
 * 404 — and course slugs come from a shared template catalogue, so a dozen
 * guesses read a shop's unpublished drafts off the status line. The previewer
 * gets through by carrying a signed parameter the proxy can check without a
 * database (`src/lib/course-preview-gate.ts`).
 *
 * **Minted on the tap rather than into the page.** The editor could have
 * embedded the token in its Preview link, and that was the first shape; this
 * one is better for two reasons. That editor is eight sections and four
 * thousand pixels tall, so a staffer reads it for twenty minutes and then taps
 * — which would need a TTL long enough to make the word "short-lived"
 * meaningless. And a capability rendered into HTML is a capability in every
 * screenshot of that page. Here it is minted at the moment a live staffer asks
 * for it, so the expiry can stay short and nothing carries it around.
 *
 * A Route Handler rather than a `page.tsx` that redirects, for the reason
 * `blockers/route.ts` gives: under `cacheComponents` a page is partially
 * prerendered, so a redirect thrown from its body answers 200 with the hop in
 * the streamed payload — a browser follows that, a bookmark manager and a
 * `curl` do not.
 *
 * **This is not the authorisation.** The public page runs its own
 * `isLiveShopStaff` a moment later, live and per-shop, so the parameter buys
 * being asked rather than being refused first. The same check runs here anyway:
 * `requireShopSurface` proves the session is staff of *this* shop, and the live
 * read proves the role has not been revoked since — "this route only redirects"
 * is exactly the reasoning by which a `/shop/**` route skips the recheck
 * (ADR-0006).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string; slug: string }> },
) {
  const { shopSlug, slug } = await params;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  if (!(await isLiveShopStaff(db, shop.id, session))) return new Response(null, { status: 404 });
  // A token for a course that is not there would redirect to a URL the edge
  // refuses anyway. Answering here costs one indexed read and says the true
  // thing rather than the same thing one hop later.
  const course = await getCourseBySlug(db, shop.id, slug);
  if (!course) return new Response(null, { status: 404 });
  // **The rows, not the request.** `requireShopSurface` has already refused a
  // slug that is not this session's shop and the read above a slug that names
  // no course, so the two are equal to what came in — but a `Location` built
  // from a path segment is a header built from user input, and the rule that
  // keeps that honest is to build it from what the database returned. The
  // signature covers the decoded slugs, which is what `publicRouteShape` hands
  // the proxy; the encoding is for the URL alone (`publicCoursePath` does not
  // encode, because every other caller passes it a slug it just rendered).
  const token = signCoursePreview(shop.slug, course.slug);
  const target = publicCoursePath(encodeURIComponent(shop.slug), encodeURIComponent(course.slug));
  // Relative `Location`, by hand: `NextResponse.redirect()` demands an absolute
  // URL, and whichever host it resolves pins the visitor to that host — in the
  // e2e fleet that landed a signed-in owner on /sign-in.
  return new Response(null, {
    status: 307,
    headers: {
      Location: `${target}?${COURSE_PREVIEW_PARAM}=${encodeURIComponent(token)}`,
      // The hop carries a capability; nothing should keep it.
      "Cache-Control": "no-store",
    },
  });
}
