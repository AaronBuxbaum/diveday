import {
  armNavigationGate,
  e2eTestRouteAuthorized,
  releaseNavigationGate,
  testRouteRefused,
} from "@/features/e2e-test-routes";
import { isUuid } from "@/lib/uuid";

// E2E-only synchronization. The normal test-route guard refuses both a
// missing harness token and any environment where the test doors are closed.
export async function POST(request: Request): Promise<Response> {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return testRouteRefused();
  const { tripId, action } = body as { tripId?: unknown; action?: unknown };
  if (typeof tripId !== "string" || !isUuid(tripId)) return testRouteRefused();
  if (action !== "arm" && action !== "release") return testRouteRefused();
  const ok = action === "arm" ? armNavigationGate(tripId) : releaseNavigationGate(tripId);
  return Response.json({ ok }, { status: ok ? 200 : 409 });
}
