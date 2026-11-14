import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "@/app/api/offline-manifests/staff-context";
import { getShopOfflineErasureEpoch } from "@/db/shops";
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
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400, headers: OFFLINE_MANIFEST_NO_STORE });
    const decoder = new TextDecoder();
    let size = 0;
    let raw = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) {
        void reader.cancel().catch(() => {});
        return new Response(null, { status: 413, headers: OFFLINE_MANIFEST_NO_STORE });
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    body = JSON.parse(raw + decoder.decode());
  } catch {
    return new Response(null, { status: 400, headers: OFFLINE_MANIFEST_NO_STORE });
  }
  const input = body as {
    nonce?: unknown;
    proof?: unknown;
    renderId?: unknown;
    checkpoint?: unknown;
    readCompletedAt?: unknown;
  } | null;
  const erasureEpoch = await getShopOfflineErasureEpoch(access.db, access.shop.id);
  const valid =
    uuidParam(tripId) &&
    typeof input?.nonce === "string" &&
    typeof input.renderId === "string" &&
    typeof input.proof === "string" &&
    typeof input.checkpoint === "string" &&
    typeof input.readCompletedAt === "number" &&
    access.user.sessionId &&
    erasureEpoch !== null &&
    verifyRosterConfirmation(
      {
        shopId: access.shop.id,
        tripId,
        sessionId: access.user.sessionId,
        nonce: input.nonce,
        renderId: input.renderId,
        erasureEpoch,
        checkpoint: input.checkpoint,
        readCompletedAt: input.readCompletedAt,
      },
      input.proof,
    );
  return new Response(null, { status: valid ? 204 : 403, headers: OFFLINE_MANIFEST_NO_STORE });
}
