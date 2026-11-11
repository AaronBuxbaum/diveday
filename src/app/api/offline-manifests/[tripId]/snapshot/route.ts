import { z } from "zod";
import { issueOfflineManifestSnapshot } from "@/features/offline-manifest-snapshots";
import { isCrossSiteRequest } from "@/features/same-origin";
import {
  OFFLINE_MANIFEST_ERASURE_EPOCH_MOVED,
  type OfflineManifestSnapshotResponse,
} from "@/lib/offline-manifests";
import { uuidParam } from "@/lib/uuid";
import { authorizeOfflineManifestStaff, OFFLINE_MANIFEST_NO_STORE } from "../../staff-context";

const bodySchema = z.object({
  erasureEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/**
 * **A device saving the manifest page's rows** (issue #4391). The page reads
 * its manifest on the pool and issues nothing; the copy a device saves needs a
 * snapshot id, the next server revision (so an older render never replaces a
 * newer copy) and the signed erasure epoch its queued notes are judged by.
 * This issues them under the erasure fence, for the epoch the page read its
 * rows at, and refuses with 409 if an erasure landed since: those rows may
 * still name the erased diver, and the device re-reads the page instead.
 *
 * POST: it writes the revision, and nothing should prefetch or replay it. A
 * request from another site is refused before anything is read.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  if (isCrossSiteRequest(request)) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
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
  const issued = await issueOfflineManifestSnapshot(
    access.db,
    access.shop.id,
    tripId,
    parsed.data.erasureEpoch,
  );
  if (!issued.ok) {
    return issued.reason === "erasure_epoch_moved"
      ? Response.json(
          { error: OFFLINE_MANIFEST_ERASURE_EPOCH_MOVED },
          { status: 409, headers: OFFLINE_MANIFEST_NO_STORE },
        )
      : Response.json({ error: "not_found" }, { status: 404, headers: OFFLINE_MANIFEST_NO_STORE });
  }
  const body: OfflineManifestSnapshotResponse = {
    snapshotId: issued.snapshotId,
    erasureEpochToken: issued.erasureEpochToken,
  };
  return Response.json(body, { headers: OFFLINE_MANIFEST_NO_STORE });
}
