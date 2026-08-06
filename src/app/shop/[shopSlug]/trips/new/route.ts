import type { NextRequest } from "next/server";

/**
 * Creating a trip is no longer a page: it is the schedule board's own add
 * panel, with everything this form used to ask behind "More options"
 * (ADR 20260806-one-trip-create-form). This route stays only to keep the links
 * that already exist working — a bookmark, a `?course=` deep link from a chat
 * message, a training doc that names the URL.
 *
 * A permanent redirect, because the move is permanent: two URLs answering "how
 * do I put a departure on the board?" is exactly the split ADR
 * 20260803-not-ready-is-a-view refused, and it is what made staff check both.
 *
 * A **Route Handler** rather than a `page.tsx` calling `permanentRedirect()`,
 * which is how `/blockers` does it. Under `cacheComponents` a page is partially
 * prerendered, so a redirect thrown from its body answers **200** with the
 * redirect resolving inside the streamed payload — that moves a browser along
 * and tells a bookmark, a crawler, or a `curl` nothing at all. A handler
 * returns the real 308 this promises, and the segment stays reserved either
 * way. No `page.tsx` also means no route-coverage row: there is no surface here
 * to screenshot or scan, only a hop.
 *
 * `?course=` is carried across rather than dropped — it is the whole point of
 * the catalogue's "schedule a session" control, and landing on a board that
 * quietly forgot which course was named is the silent kind of "it still works".
 * `add=full` because this URL only ever meant the full form.
 *
 * Auth is unchanged: the hop lands on `/shop/<slug>/schedule/board`, which the
 * edge layer gates like every other `/shop/**` path.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  const { shopSlug } = await params;
  const query = new URLSearchParams({ add: "full" });
  const course = request.nextUrl.searchParams.get("course");
  if (course) query.set("course", course);
  // A *relative* `Location`, built by hand rather than through
  // `NextResponse.redirect()`, which demands an absolute URL and so forces a
  // choice of host. Whatever host it resolves from is a host this hop then
  // pins the visitor to — behind a proxy, on an alternate origin, or in the
  // e2e fleet (where it resolved `localhost` for a session cookied to
  // `127.0.0.1` and landed a signed-in owner on /sign-in). RFC 7231 allows a
  // relative Location, every browser follows it, and it keeps the visitor on
  // the origin they were already on.
  return new Response(null, {
    status: 308,
    headers: { Location: `/shop/${shopSlug}/schedule/board?${query.toString()}` },
  });
}
