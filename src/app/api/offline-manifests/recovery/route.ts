import { z } from "zod";
import { getShopOfflineErasureEpoch } from "@/db/shops";
import {
  liveManifestSessionHandle,
  signLiveManifestRecovery,
} from "@/features/live-manifest-server";
import { isCrossSiteHeaders } from "@/features/same-origin";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { authorizeOfflineManifestStaff, OFFLINE_MANIFEST_NO_STORE } from "../staff-context";

const MAX_BODY_BYTES = 1024;
const BODY_TIMEOUT_MS = 5000;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const challengeSchema = z
  .object({ tombstone: z.string().regex(uuidV4), nonce: z.string().regex(uuidV4) })
  .strict();

async function readChallenge(
  request: Request,
): Promise<
  | { kind: "ok"; value: z.infer<typeof challengeSchema> }
  | { kind: "oversized" | "invalid" | "timeout" }
> {
  if (!request.body) return { kind: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), BODY_TIMEOUT_MS);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part === "timeout") {
        void reader.cancel().catch(() => {});
        return { kind: "timeout" };
      }
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return { kind: "oversized" };
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const parsed = challengeSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return parsed.success ? { kind: "ok", value: parsed.data } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/** A recent live staff and erasure observation, never a roster or a cache authorization. */
export async function POST(request: Request) {
  if (isCrossSiteHeaders(request.headers))
    return new Response(null, { status: 403, headers: OFFLINE_MANIFEST_NO_STORE });
  const challenge = await readChallenge(request);
  if (challenge.kind !== "ok")
    return new Response(null, {
      status: challenge.kind === "oversized" ? 413 : challenge.kind === "timeout" ? 408 : 400,
      headers: OFFLINE_MANIFEST_NO_STORE,
    });
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  const sessionHandle =
    access.user.sessionId && liveManifestSessionHandle(access.shop.id, access.user.sessionId);
  const erasureEpoch = await getShopOfflineErasureEpoch(access.db, access.shop.id);
  if (!sessionHandle || erasureEpoch === null)
    return new Response(null, { status: 503, headers: OFFLINE_MANIFEST_NO_STORE });
  const issuedAt = nowMs();
  const binding = {
    shopId: access.shop.id,
    sessionHandle,
    ...challenge.value,
    erasureEpoch,
    issuedAt,
    expiresAt: issuedAt + MINUTE_MS,
  };
  const proof = signLiveManifestRecovery(binding);
  if (!proof) return new Response(null, { status: 503, headers: OFFLINE_MANIFEST_NO_STORE });
  return Response.json(
    { ...binding, proof },
    { headers: { ...OFFLINE_MANIFEST_NO_STORE, Date: new Date(issuedAt).toUTCString() } },
  );
}
