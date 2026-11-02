import { getDb } from "@/db/client";
import { medicalAlertsForOfflineSave } from "@/db/medical-alerts";
import { getShopById } from "@/db/shops";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { isCrossSiteRequest } from "@/lib/same-origin";
import { uuidParam } from "@/lib/uuid";

/** Per-session and medical: never held by any cache. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * **The medical alerts' words for one departure's offline copy** (H-20261023-medical-alert-for-the
 * amendment, issue #2960). The only way the words reach a device copy: a
 * permitted reader (the owner, a manager, or crew a manager put on this
 * departure, `canPersonReadMedicalAlertOnTrip`) taps save-for-offline on the
 * departure's manifest, and the page puts what this answers onto the copy it
 * already holds (`saveOfflineMedicalAlerts`). The page payload and the
 * background board (`/api/offline-manifests/upcoming`) never carry them.
 *
 * Handing the words out is a read, so it is recorded here, on the server and
 * online: one `medical_alert_saved_offline` line per diver on the departure,
 * at most one per reader, diver and departure in ten minutes. Opening the
 * copy at sea writes nothing more.
 *
 * POST, not GET: it writes the trail, and nothing should prefetch or replay
 * it. A request from another site is refused before anything is read
 * (`isCrossSiteRequest`): a route handler gets no server-action origin check.
 * Every refusal says nothing about whether an alert exists.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  if (isCrossSiteRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }
  const tripId = uuidParam((await params).tripId);
  if (!tripId) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  // Live roles and the live roster, re-read there: the session's roles are
  // whatever the token was stamped with.
  const handed = await medicalAlertsForOfflineSave(db, {
    shopId: shop.id,
    tripId,
    readerId: session.user.personId,
  });
  if (!handed.ok) {
    return Response.json(
      { error: handed.reason },
      { status: handed.reason === "not_found" ? 404 : 403, headers: NO_STORE },
    );
  }
  return Response.json(handed.body, { headers: NO_STORE });
}
