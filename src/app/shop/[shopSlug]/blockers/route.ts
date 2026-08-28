import { requireStaffSession } from "@/lib/session";

/**
 * Not ready is no longer a page, and no longer a view of one either: the shop
 * home is a single chronological spine, and every diver who cannot board is a
 * row on the station of the boat that is waiting for them (ADR
 * 20260827-clearwater-surface-language, decision 4). This route stays only to
 * keep the links already out in the world working — a bookmark, an old chat
 * message.
 *
 * **One hop.** It used to 308 to `/shop/<slug>?view=departures`, and that query
 * is itself now a 308 back to the bare home, so leaving it would have made
 * every one of those bookmarks a two-redirect chain. A `?page=` is dropped for
 * the same reason it would be honoured if it still meant anything: it paged a
 * queue that does not exist, and carrying a number into a URL that ignores it
 * is worse than dropping it.
 *
 * A Route Handler, not a `page.tsx` calling `permanentRedirect()`: under
 * `cacheComponents` a page is partially prerendered, so a redirect thrown from
 * its body answers **200** with the hop resolving in the streamed payload — a
 * browser follows it, a bookmark manager, a crawler, and a `curl` do not
 * (ADR 20260806-one-trip-create-form). And it re-checks the session
 * server-side (ADR-0006) rather than trusting the edge proxy alone — "this
 * route is only a redirect" is exactly the reasoning by which a `/shop/**`
 * route ends up as the one that skipped the recheck.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  await requireStaffSession();
  const { shopSlug } = await params;
  // A relative `Location`, by hand: `NextResponse.redirect()` demands an
  // absolute URL, and whichever host it resolves pins the visitor to that host
  // — in the e2e fleet it resolved `localhost` for a session cookied to
  // `127.0.0.1` and landed a signed-in owner on /sign-in.
  return new Response(null, {
    status: 308,
    headers: { Location: `/shop/${shopSlug}` },
  });
}
