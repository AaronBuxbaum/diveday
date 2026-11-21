import { z } from "zod";
import { offlineManifestTripExists } from "@/features/boarding/offline-manifest-snapshots";
import { isCrossSiteHeaders } from "@/features/platform/same-origin";
import { supportsCausalRollCall } from "@/lib/roll-call-protocol";
import { uuidParam } from "@/lib/uuid";
import { authorizeOfflineManifestStaff, OFFLINE_MANIFEST_NO_STORE } from "../../staff-context";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bodySchema = z.object({ erasureEpoch: counter, snapshotRevision: counter });

/** Refuse legacy page claims; the client must load the current application before saving. */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  if (isCrossSiteHeaders(request.headers)) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  if (!supportsCausalRollCall(request))
    return Response.json(
      { error: "offline_update_required" },
      { status: 426, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const tripId = uuidParam((await params).tripId);
  if (!tripId) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  const owned = await offlineManifestTripExists(access.db, access.shop.id, tripId);
  if (!owned)
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  return Response.json(
    { error: "offline_update_required" },
    { status: 426, headers: OFFLINE_MANIFEST_NO_STORE },
  );
}
