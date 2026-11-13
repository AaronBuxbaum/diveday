import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "@/app/api/offline-manifests/staff-context";
import { verifyRosterConfirmation } from "@/features/offline-manifest-snapshots";
import { uuidParam } from "@/lib/uuid";

/** Verify the session for the roster already delivered, without returning roster data. */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  const { tripId } = await params;
  let body: unknown;
  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 1024)
      return new Response(null, { status: 413, headers: OFFLINE_MANIFEST_NO_STORE });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1024)
      return new Response(null, { status: 413, headers: OFFLINE_MANIFEST_NO_STORE });
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400, headers: OFFLINE_MANIFEST_NO_STORE });
  }
  const input = body as { nonce?: unknown; proof?: unknown; renderId?: unknown } | null;
  const valid =
    uuidParam(tripId) &&
    typeof input?.nonce === "string" &&
    typeof input.renderId === "string" &&
    typeof input.proof === "string" &&
    access.user.sessionId &&
    verifyRosterConfirmation(
      {
        shopId: access.shop.id,
        tripId,
        sessionId: access.user.sessionId,
        nonce: input.nonce,
        renderId: input.renderId,
      },
      input.proof,
    );
  return new Response(null, { status: valid ? 204 : 403, headers: OFFLINE_MANIFEST_NO_STORE });
}
