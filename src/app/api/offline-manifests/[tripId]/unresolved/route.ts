import { isCrossSiteHeaders } from "@/features/same-origin";
import {
  listRetainedSafetyReviewEntries,
  unresolvedReviewAvailable,
} from "@/features/unresolved-roll-call";
import { uuidParam } from "@/lib/uuid";
import { authorizeOfflineManifestStaff, OFFLINE_MANIFEST_NO_STORE } from "../../staff-context";

/** A paged review index, not a receipt or a decision on an observation. */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const refuse = (error: string, status: number) =>
    Response.json({ error }, { status, headers: OFFLINE_MANIFEST_NO_STORE });
  if (isCrossSiteHeaders(request.headers)) return refuse("forbidden", 403);
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  const sessionId = uuidParam(access.user.sessionId);
  if (!sessionId) return refuse("authentication_required", 401);
  const tripId = uuidParam((await params).tripId);
  if (!tripId) return refuse("not_found", 404);
  if (!unresolvedReviewAvailable()) return refuse("review_unavailable", 503);
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/json"
  )
    return refuse("invalid_content_type", 415);
  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? "0") > 1024)
      return refuse("too_large", 413);
    const reader = request.body?.getReader();
    if (!reader) return refuse("invalid_cursor", 400);
    const decoder = new TextDecoder();
    let size = 0;
    let raw = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) {
        void reader.cancel().catch(() => {});
        return refuse("too_large", 413);
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    body = JSON.parse(raw + decoder.decode());
  } catch {
    return refuse("invalid_cursor", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return refuse("invalid_cursor", 400);
  const value = (body as { cursor?: unknown }).cursor;
  const cursor = typeof value === "string" ? uuidParam(value) : undefined;
  if (value != null && !cursor) return refuse("invalid_cursor", 400);
  const frontier = (body as { frontier?: unknown }).frontier;
  if (cursor && (typeof frontier !== "string" || !/^[0-9a-f]{64}$/.test(frontier)))
    return refuse("invalid_frontier", 400);
  if (!cursor && frontier != null) return refuse("invalid_frontier", 400);
  const result = await listRetainedSafetyReviewEntries(access.db, {
    shopId: access.shop.id,
    staffPersonId: access.user.personId,
    sessionId,
    tripId,
    cursor,
    frontier: typeof frontier === "string" ? frontier : undefined,
  });
  if (!result.ok)
    return refuse(
      result.reason,
      result.reason === "forbidden"
        ? 403
        : result.reason === "unavailable"
          ? 503
          : result.reason === "review_changed"
            ? 409
            : result.reason === "too_many"
              ? 422
              : 404,
    );
  return Response.json(
    { entries: result.entries, nextCursor: result.nextCursor, frontier: result.frontier },
    { headers: OFFLINE_MANIFEST_NO_STORE },
  );
}
