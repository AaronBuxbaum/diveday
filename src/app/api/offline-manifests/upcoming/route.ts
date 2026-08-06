import { getDb } from "@/db/client";
import { getTripManifests } from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { listTripIdsInOfflineManifestWindow } from "@/db/trips";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type {
  OfflineManifestPayload,
  OfflineManifestUpcomingResponse,
} from "@/lib/offline-manifests";
import { serializeManifests } from "@/lib/offline-manifests";

// See ADR 20260726-shopwide-offline-manifest-priming: 48 hours covers "today
// and tomorrow" in any shop timezone without depending on a staffer having
// opened that specific trip's live manifest first, while staying well short
// of caching a shop's entire future board on every device that visits it.
const AUTO_SAVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * This body is a shop's whole 48-hour board — diver names, emergency contacts,
 * readiness blockers — and it must never sit in any cache but the encrypted
 * IndexedDB store it is fetched to fill. `private` keeps it out of a shared
 * proxy; `no-store` keeps it out of the browser's own disk cache and out of a
 * back/forward replay on the shared boat tablet this whole feature runs on
 * (review 20260802, action item 12).
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Every scheduled trip in the rolling window — including one already
 * underway, not only ones yet to depart, so a trip mid-charter still gets
 * its after-dive-checkpoint copy auto-saved — serialized the same way a
 * single trip's live manifest page is, so the client can feed each one
 * straight into the existing saveOfflineManifest path unchanged.
 * Staff-session-gated and scoped to the caller's own shop, the same way the
 * per-trip manifest page and its SSE stream are.
 *
 * Only for callers that genuinely want the roster: the shop layout's
 * `OfflineManifestAutoSave` and the service worker's `refreshSavedManifests`.
 * A caller that only needs to know *which shop this browser is signed in as*
 * asks `GET /api/offline-manifests/identity` instead, which answers with one
 * string and none of this.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const now = nowDate();
  const windowEnd = new Date(now.getTime() + AUTO_SAVE_WINDOW_MS);
  const tripIds = await listTripIdsInOfflineManifestWindow(db, shop.id, now, windowEnd);

  const shopIdentity = { slug: shop.slug, name: shop.name, timezone: shop.timezone };
  const payloads = await Promise.all(
    tripIds.map(async (tripId): Promise<OfflineManifestPayload | null> => {
      const manifests = await getTripManifests(db, shop.id, tripId);
      if (!manifests) return null;
      return serializeManifests(manifests, shopIdentity, (blocker) =>
        readinessBlockerText(t, blocker),
      );
    }),
  );

  const body: OfflineManifestUpcomingResponse = {
    // Always returned, even with zero trips in the window: a caller that is
    // already paying for the roster gets the server-verified "who am I signed
    // in as" signal in the same response rather than a second request, and uses
    // it to purge any other shop's leftover device records — see ADR
    // 20260726-shopwide-offline-manifest-priming's cross-tenant-device
    // addendum. A payload can never carry a shop.slug the caller doesn't own
    // (serializeManifests only ever receives this same session-derived shop).
    // A caller that wants *only* this asks `/api/offline-manifests/identity`,
    // which is the same string without the board attached.
    shop: shopIdentity,
    payloads: payloads.filter((payload): payload is OfflineManifestPayload => payload !== null),
  };
  return Response.json(body, { headers: NO_STORE });
}
