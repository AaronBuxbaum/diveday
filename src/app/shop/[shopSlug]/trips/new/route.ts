import type { NextRequest } from "next/server";
import { requireStaffSession } from "@/lib/session";

/**
 * 308 to the board's add panel, which is now the only trip form
 * (ADR 20260806-one-trip-create-form).
 *
 * A Route Handler, not a `page.tsx` calling `permanentRedirect()`: under
 * `cacheComponents` a page is partially prerendered, so a redirect thrown from
 * its body answers **200** with the hop resolving in the streamed payload — a
 * browser follows it, a bookmark, a crawler, and a `curl` do not. And it
 * re-checks the session server-side (ADR-0006) rather than trusting the edge
 * proxy alone, same as its `/blockers`, `/settings/backup`, and
 * `/dive-sites/catalog` siblings.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  await requireStaffSession();
  const { shopSlug } = await params;
  const query = new URLSearchParams({ add: "full" });
  const course = request.nextUrl.searchParams.get("course");
  if (course) query.set("course", course);
  // A relative `Location`, by hand: `NextResponse.redirect()` demands an
  // absolute URL, and whichever host it resolves pins the visitor to that host
  // — in the e2e fleet it resolved `localhost` for a session cookied to
  // `127.0.0.1` and landed a signed-in owner on /sign-in.
  return new Response(null, {
    status: 308,
    headers: { Location: `/shop/${shopSlug}/schedule/board?${query.toString()}` },
  });
}
