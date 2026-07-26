import { getDb } from "@/db/client";
import { getTripManifests } from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { listTripIdsInOfflineManifestWindow } from "@/db/trips";
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
 * Every scheduled trip in the rolling window — including one already
 * underway, not only ones yet to depart, so a trip mid-charter still gets
 * its after-dive-checkpoint copy auto-saved — serialized the same way a
 * single trip's live manifest page is, so the client can feed each one
 * straight into the existing saveOfflineManifest path unchanged.
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
  const tripIds = await listTripIdsInOfflineManifestWindow(db, shop.id, now, windowEnd);

  const shopIdentity = { slug: shop.slug, name: shop.name, timezone: shop.timezone };
  const payloads = await Promise.all(
    tripIds.map(async (tripId): Promise<OfflineManifestPayload | null> => {
      const manifests = await getTripManifests(db, shop.id, tripId);
      if (!manifests) return null;
      return serializeManifests(manifests, shopIdentity);
    }),
  );

  return Response.json({
    // Always returned, even with zero trips in the window: the client uses
    // this as the server-verified "who am I signed in as" signal to purge any
    // other shop's leftover device records — see ADR
    // 20260726-shopwide-offline-manifest-priming's cross-tenant-device
    // addendum. A payload can never carry a shop.slug the caller doesn't own
    // (serializeManifests only ever receives this same session-derived shop).
    shop: shopIdentity,
    payloads: payloads.filter((payload): payload is OfflineManifestPayload => payload !== null),
  });
}
