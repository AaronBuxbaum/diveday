import { type NextRequest, NextResponse } from "next/server";
import { publicAvailabilityTrips } from "@/db/availability";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { availabilityDocument } from "@/lib/availability";
import { nowDate } from "@/lib/clock";
import { publicAppUrl } from "@/lib/notifications";

/**
 * `/s/<shop>/availability.json` — the shop's open seats for a reader that is
 * not a person (issue #1427). Shape and boundaries in
 * `src/lib/availability.ts`; rows from `src/db/availability.ts`. This route
 * decides only who may read it and for how long.
 *
 * **A shop that opted out of search is 404 here, not an empty list.** The
 * schedule page answers its opt-out with `noindex` because a person with the
 * link still has to see the page; this document exists for nobody but a
 * machine, so the honest answer to "may I read it" is no (ADR
 * 20260813-search-listing-is-a-choice). A demo shop is served: the per-visitor
 * demo is its own throwaway playground, and the canonical fixture is what the
 * e2e fleet reads.
 *
 * **A shop that does not exist is usually refused before this runs.** The edge
 * check answers the whole `/s/**` namespace above the streaming boundary (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge), and it stamps the same
 * `no-store` this branch does, so the intent survives the hop. The opt-out
 * refusal below is untouched by it — an opted-out shop is still a shop, and
 * `publicRouteLookup` says so on purpose — and the `!shop` branch is still
 * live, because the edge fails open on a database throw and a shop can be
 * deleted between the two reads.
 *
 * Five minutes at a shared cache, one at the reader: seats move as bookings
 * land, and the booking page has the last word either way. `noindex` because
 * this is an answer for an agent, not a search result.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.searchListingOptOutAt) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const now = nowDate();
  const trips = await publicAvailabilityTrips(db, shop, now);
  const origin = publicAppUrl() ?? new URL(request.url).origin;
  return NextResponse.json(availabilityDocument(shop, trips, origin, now), {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
