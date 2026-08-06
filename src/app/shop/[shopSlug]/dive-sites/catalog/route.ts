import type { NextRequest } from "next/server";
import { requireStaffSession } from "@/lib/session";

/**
 * The common-sites catalog is no longer a page: it is the dive-site library's
 * own **catalog view** (`?view=catalog`), folded in because it was reachable
 * from exactly two buttons on that page and nowhere else — the same move
 * 20260803-not-ready-is-a-view made for the by-departure queue. This route
 * stays only to keep the links that already exist working: a bookmark, a
 * `?page=` deep link into a long catalog, an old chat message.
 *
 * A permanent redirect, because the move is permanent. `?page=` is carried
 * across rather than dropped — landing a bookmarked page 3 on page 1 is the
 * silent kind of "it still works" that makes staff re-hunt for a template
 * they had already found.
 *
 * A Route Handler, not a `page.tsx` calling `permanentRedirect()`: under
 * `cacheComponents` a page is partially prerendered, so a redirect thrown from
 * its body answers **200** with the hop resolving in the streamed payload — a
 * browser follows it, a bookmark, a crawler, and a `curl` do not
 * (ADR 20260806-one-trip-create-form). And it re-checks the session
 * server-side (ADR-0006) rather than trusting the edge proxy alone — "this
 * route is only a redirect" is exactly the reasoning by which a `/shop/**`
 * route ends up as the one that skipped the recheck.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  await requireStaffSession();
  const { shopSlug } = await params;
  const query = new URLSearchParams({ view: "catalog" });
  // Only a real page beyond the first is worth carrying; `page=1`, `page=0`,
  // and `page=banana` all mean "the start of the catalog", which is the default.
  const requested = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "", 10);
  if (Number.isFinite(requested) && requested > 1) query.set("page", String(requested));
  // A relative `Location`, by hand: `NextResponse.redirect()` demands an
  // absolute URL, and whichever host it resolves pins the visitor to that host
  // — in the e2e fleet it resolved `localhost` for a session cookied to
  // `127.0.0.1` and landed a signed-in owner on /sign-in.
  return new Response(null, {
    status: 308,
    headers: { Location: `/shop/${shopSlug}/dive-sites?${query.toString()}` },
  });
}
