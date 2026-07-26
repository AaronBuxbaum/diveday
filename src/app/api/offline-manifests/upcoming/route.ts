import { getDb } from "@/db/client";
import { getTripManifests } from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { upcomingTripsWithCounts } from "@/db/trips";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type { OfflineManifestPayload } from "@/lib/offline-manifests";
import { serializeManifests } from "@/lib/offline-manifests";

// See ADR 20260726-shopwide-offline-manifest-priming: 48 hours covers "today
// and tomorrow" in any shop timezone without depending on a staffer having
// opened that specific trip's live manifest first, while staying well short
// of caching a shop's entire future board on every device that visits it.
const AUTO_SAVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Every scheduled trip departing within the rolling window, serialized the
 * same way a single trip's live manifest page is — so the client can feed
 * each one straight into the existing saveOfflineManifest path unchanged.
 * Staff-session-gated and scoped to the caller's own shop, the same way the
 * per-trip manifest page and its SSE stream are.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return Response.json({ error: "not_found" }, { status: 404 });

  const now = nowDate();
  const windowEnd = new Date(now.getTime() + AUTO_SAVE_WINDOW_MS);
  const trips = (await upcomingTripsWithCounts(db, shop.id, now)).filter(
    (trip) => trip.startsAt <= windowEnd,
  );

  const payloads = await Promise.all(
    trips.map(async (trip): Promise<OfflineManifestPayload | null> => {
      const manifests = await getTripManifests(db, shop.id, trip.id);
      if (!manifests) return null;
      return serializeManifests(manifests, {
        slug: shop.slug,
        name: shop.name,
        timezone: shop.timezone,
      });
    }),
  );

  return Response.json({
    payloads: payloads.filter((payload): payload is OfflineManifestPayload => payload !== null),
  });
}
