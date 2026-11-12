import { z } from "zod";
import { issueOfflineManifestSnapshot } from "@/features/offline-manifest-snapshots";
import { isCrossSiteHeaders } from "@/features/same-origin";
import type {
  OfflineManifestSnapshotRequest,
  OfflineManifestSnapshotResponse,
} from "@/lib/offline-manifests";
import { uuidParam } from "@/lib/uuid";
import { authorizeOfflineManifestStaff, OFFLINE_MANIFEST_NO_STORE } from "../../staff-context";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bodySchema = z.object({ erasureEpoch: counter, snapshotRevision: counter });

/**
 * **A device saving the manifest page's rows** (issue #4391). The page reads
 * its manifest on the pool and issues nothing; the copy a device saves needs a
 * snapshot id, the next server revision (so an older read never replaces a
 * newer copy) and the signed erasure epoch its queued notes are judged by.
 * This issues them under the erasure fence, for the epoch and revision the
 * page read its rows at, and refuses with 409 before any write if an erasure
 * landed since (`erasure_epoch_moved`: the rows may still name the erased
 * diver) or another copy was issued since (`snapshot_superseded`: its rows
 * are newer). The device re-reads the page instead.
 *
 * POST: it writes the revision, and nothing should prefetch or replay it. A
 * request from another site is refused before anything is read, judged
 * against the host the request was sent to (`isCrossSiteHeaders`): behind a
 * proxy the handler's own `request.url` need not carry the page's origin, and
 * the page's own save sends an `Origin`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  if (isCrossSiteHeaders(request.headers)) {
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
  const readAt: OfflineManifestSnapshotRequest = parsed.data;
  const issued = await issueOfflineManifestSnapshot(access.db, access.shop.id, tripId, readAt);
  if (!issued.ok) {
    return issued.reason === "not_found"
      ? Response.json({ error: "not_found" }, { status: 404, headers: OFFLINE_MANIFEST_NO_STORE })
      : Response.json(
          { error: issued.reason },
          { status: 409, headers: OFFLINE_MANIFEST_NO_STORE },
        );
  }
  const body: OfflineManifestSnapshotResponse = {
    snapshotId: issued.snapshotId,
    erasureEpochToken: issued.erasureEpochToken,
  };
  return Response.json(body, { headers: OFFLINE_MANIFEST_NO_STORE });
}
