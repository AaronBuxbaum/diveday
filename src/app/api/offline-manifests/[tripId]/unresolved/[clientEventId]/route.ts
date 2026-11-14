import { isCrossSiteHeaders } from "@/features/same-origin";
import {
  readUnresolvedRollCallObservation,
  unresolvedReviewAvailable,
} from "@/features/unresolved-roll-call";
import { uuidParam } from "@/lib/uuid";
import { authorizeOfflineManifestStaff, OFFLINE_MANIFEST_NO_STORE } from "../../../staff-context";

/** A read for review, never a receipt or a resolution of the observation. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tripId: string; clientEventId: string }> },
) {
  if (isCrossSiteHeaders(request.headers)) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  const sessionId = uuidParam(access.user.sessionId);
  if (!sessionId) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  const route = await params;
  const tripId = uuidParam(route.tripId);
  const clientEventId = uuidParam(route.clientEventId);
  if (!tripId || !clientEventId) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  if (!unresolvedReviewAvailable()) {
    return Response.json(
      { error: "review_unavailable" },
      { status: 503, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  }
  const result = await readUnresolvedRollCallObservation(access.db, {
    shopId: access.shop.id,
    staffPersonId: access.user.personId,
    sessionId,
    tripId,
    clientEventId,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.reason },
      {
        status:
          result.reason === "forbidden"
            ? 403
            : result.reason === "unavailable"
              ? 503
              : result.reason === "observation_unreadable"
                ? 409
                : 404,
        headers: OFFLINE_MANIFEST_NO_STORE,
      },
    );
  }
  return Response.json({ claim: result.claim }, { headers: OFFLINE_MANIFEST_NO_STORE });
}
