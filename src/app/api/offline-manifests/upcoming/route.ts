import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "@/app/api/offline-manifests/staff-context";
import { listTripIdsInOfflineManifestWindow } from "@/db/trips";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { withE2EApiTiming } from "@/lib/observability/query-timing";
import { supportsCausalRollCall } from "@/lib/roll-call-protocol";

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
/**
 * Every scheduled trip in the rolling window — including one already
 * underway, not only ones yet to depart, so a trip mid-charter still gets
 * its after-dive-checkpoint copy auto-saved — serialized the same way a
 * single trip's live manifest page is, so the client can feed each one
 * straight into the existing saveOfflineManifest path unchanged.
 * Staff-session-gated and scoped to the caller's own shop, the same way the
 * per-trip manifest page and its SSE stream are — and gated on the caller's
 * *live* roles, byte-identically to `/api/offline-manifests/identity`. This is
 * the body that made that matter: a staffer removed from the shop kept pulling
 * the whole board from any device for as long as their token lasted.
 *
 * Only for callers that genuinely want the roster: the shop layout's
 * `OfflineManifestAutoSave` and the service worker's `refreshSavedManifests`.
 * A caller that only needs to know *which shop this browser is signed in as*
 * asks `GET /api/offline-manifests/identity` instead, which answers with one
 * string and none of this.
 */
async function getUpcomingManifests(request: Request) {
  const access = await authorizeOfflineManifestStaff();
  if (access.ok === false) return access.response;
  if (!supportsCausalRollCall(request))
    return Response.json(
      { error: "offline_update_required" },
      { status: 426, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const { db, shop, user } = access;

  const now = nowDate();
  const tripIds = await listTripIdsInOfflineManifestWindow(
    db,
    shop.id,
    now,
    new Date(now.getTime() + AUTO_SAVE_WINDOW_MS),
  );
  const body = await buildOfflineManifestCopies(db, shop, user.personId, tripIds);
  return Response.json(body, { headers: OFFLINE_MANIFEST_NO_STORE });
}

export function GET(request: Request) {
  return withE2EApiTiming("/api/offline-manifests/upcoming GET", () =>
    getUpcomingManifests(request),
  );
}
