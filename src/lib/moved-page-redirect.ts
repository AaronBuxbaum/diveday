import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * **A staff page that moved, answered from its old address.** The old URL is
 * a bookmark, a chat message, a notice an old email carried; this keeps it
 * working with one 308 to the new place and carries the query string, so a
 * `?notice=` a stale form posted back still reads.
 *
 * A Route Handler rather than a `page.tsx` that redirects, for the reason
 * `blockers/route.ts` gives: under `cacheComponents` a page answers 200 with
 * the hop resolving in the stream, which a bookmark manager or `curl` does
 * not follow. It re-checks the session (ADR-0006) rather than trusting the
 * edge proxy; the page it lands on re-checks its own permission.
 *
 * The `Location` is relative and by hand: `NextResponse.redirect()` wants an
 * absolute URL, and whichever host it picked pinned the visitor to that host.
 * Every segment goes through `shopPath`, so the slug (a client-supplied
 * argument) cannot reach outside the shop.
 */
export async function movedPageRedirect(
  request: Request,
  shopSlug: string,
  ...segments: string[]
): Promise<Response> {
  await requireStaffSession();
  const search = new URL(request.url).search;
  return new Response(null, {
    status: 308,
    headers: { Location: `${shopPath(shopSlug, ...segments)}${search}` },
  });
}
