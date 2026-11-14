import { isCrossSiteHeaders } from "@/features/same-origin";
import {
  deferUnresolvedReview,
  unresolvedDeferralAvailable,
  unresolvedReviewAvailable,
} from "@/features/unresolved-roll-call";
import { uuidParam } from "@/lib/uuid";
import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "../../../../staff-context";

/** Deferral keeps the observation and its safety warning open. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tripId: string; clientEventId: string }> },
) {
  const refuse = (error: string, status: number) =>
    Response.json({ error }, { status, headers: OFFLINE_MANIFEST_NO_STORE });
  if (isCrossSiteHeaders(request.headers)) return refuse("forbidden", 403);
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  const sessionId = uuidParam(access.user.sessionId);
  if (!sessionId) return refuse("authentication_required", 401);
  const route = await params;
  const tripId = uuidParam(route.tripId);
  const clientEventId = uuidParam(route.clientEventId);
  if (!tripId || !clientEventId) return refuse("not_found", 404);
  if (!unresolvedReviewAvailable() || !unresolvedDeferralAvailable())
    return refuse("review_unavailable", 503);
  const reviewRevision = uuidParam(request.headers.get("x-review-revision"));
  const requestId = uuidParam(request.headers.get("x-review-request-id"));
  if (!reviewRevision || !requestId) return refuse("invalid_request", 400);
  const result = await deferUnresolvedReview(access.db, {
    shopId: access.shop.id,
    staffPersonId: access.user.personId,
    sessionId,
    tripId,
    clientEventId,
    reviewRevision,
    requestId,
  });
  if (!result.ok)
    return refuse(
      result.reason,
      result.reason === "forbidden"
        ? 403
        : result.reason === "invalid"
          ? 400
          : result.reason === "not_found"
            ? 404
            : result.reason === "unavailable"
              ? 503
              : 409,
    );
  return Response.json(
    { deferred: true, duplicate: result.duplicate },
    { headers: OFFLINE_MANIFEST_NO_STORE },
  );
}
