import { and, eq } from "drizzle-orm";
import { canPersonReadMedicalAlertOnTrip } from "@/db/authz";
import { getDb } from "@/db/client";
import { medicalAlertsForTrip, recordMedicalAlertTrailLine } from "@/db/medical-alerts";
import { people, trips } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { liveTrip } from "@/db/trips-live";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type { OfflineMedicalAlertsResponse } from "@/lib/offline-manifests";
import { uuidParam } from "@/lib/uuid";

/** Per-session and medical: never held by any cache. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * **The medical alerts' words for one departure's offline copy** (H-153
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
 * it. Every refusal says nothing about whether an alert exists.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }
  const tripId = uuidParam((await params).tripId);
  if (!tripId) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shop.id), liveTrip()))
    .limit(1);
  if (!trip) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const reader = session.user.personId;
  // Live roles and the live roster, re-read here: the session's roles are
  // whatever the token was stamped with.
  if (!(await canPersonReadMedicalAlertOnTrip(db, shop.id, reader, trip.id))) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const [person] = await db
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, reader), eq(people.shopId, shop.id)))
    .limit(1);
  if (!person) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });

  const alerts = await medicalAlertsForTrip(db, shop.id, trip.id);
  const texts: Record<string, string> = {};
  for (const [bookingId, alert] of alerts) {
    // The line goes on the trail before the words are handed out; a trail
    // that refuses it hands out nothing for that diver.
    const recorded = await recordMedicalAlertTrailLine(db, {
      shopId: shop.id,
      personId: alert.personId,
      actorPersonId: reader,
      code: "medical_alert_saved_offline",
      departureId: trip.id,
    });
    if (recorded) texts[bookingId] = alert.text;
  }
  const body: OfflineMedicalAlertsResponse = {
    texts,
    savedBy: { personId: reader, name: person.name, savedAt: nowDate().toISOString() },
  };
  return Response.json(body, { headers: NO_STORE });
}
