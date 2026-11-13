import {
  clearManifestReadCount,
  e2eTestRouteAuthorized,
  getManifestReadCount,
  resetManifestReadCount,
  testRouteRefused,
} from "@/features/e2e-test-routes";
import { isUuid } from "@/lib/uuid";

/** Test-only observation of roster-read attempts in this E2E worker. */
export async function POST(request: Request): Promise<Response> {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return testRouteRefused();
  const { tripId, action } = body as { tripId?: unknown; action?: unknown };
  if (typeof tripId !== "string" || !isUuid(tripId)) return testRouteRefused();
  if (action === "reset") resetManifestReadCount(tripId);
  else if (action === "clear") clearManifestReadCount(tripId);
  else if (action !== "read") return testRouteRefused();
  return Response.json({ count: getManifestReadCount(tripId) ?? null });
}
