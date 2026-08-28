import { requireStaffSession } from "@/lib/session";

/**
 * **Close-out is no longer a destination** (H-62, 2026-08-27; ADR
 * 20260827-clearwater-surface-language, decision 4).
 *
 * The evening is not a second page: the shop home's spine settles station by
 * station as head counts close, and the closing block — the leftovers, then
 * the one closing act — appears beneath it once every departure of the shop
 * day has ended. A route whose only job was to re-render Today's own evidence
 * in a different order is the thing the fold removes; `day_closeouts`, the
 * close act and the departure log are all unchanged underneath it.
 *
 * The whole query survives the hop, because every `?notice=` this page used to
 * answer (a recap sent, a photo removed, a log refused for a non-owner) is a
 * notice the home now answers in its place. Nothing is rewritten on the way:
 * the codes did not change, only where they land.
 *
 * A Route Handler, not a `page.tsx` calling `permanentRedirect()`: under
 * `cacheComponents` a page is partially prerendered, so a redirect thrown from
 * its body answers **200** with the hop resolving in the streamed payload — a
 * browser follows it, a bookmark manager, a crawler and a `curl` do not (ADR
 * 20260806-one-trip-create-form). And it re-checks the session server-side
 * (ADR-0006) rather than trusting the edge proxy alone.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  await requireStaffSession();
  const { shopSlug } = await params;
  const { search } = new URL(request.url);
  // A relative `Location`, by hand: `NextResponse.redirect()` demands an
  // absolute URL, and whichever host it resolves pins the visitor to that host
  // — in the e2e fleet it resolved `localhost` for a session cookied to
  // `127.0.0.1` and landed a signed-in owner on /sign-in.
  return new Response(null, {
    status: 308,
    headers: { Location: `/shop/${shopSlug}${search}` },
  });
}
