import { authSecret } from "@/lib/auth-secret";
import { deriveLabelKey, signPayload } from "@/lib/signed-token";

/**
 * A stable, purpose-separated non-bearer cache handle. It is not a session
 * credential or evidence that a session is currently valid; the caller must
 * authorize against the database on every online use.
 */
export function liveManifestSessionHandle(shopId: string, sessionId: string): string | null {
  if (
    !authSecret ||
    typeof shopId !== "string" ||
    !shopId ||
    shopId.length > 128 ||
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.length > 512
  )
    return null;
  const key = deriveLabelKey(authSecret, "diveday-live-manifest-session-handle-v1");
  return signPayload(key, JSON.stringify([shopId, sessionId]));
}
