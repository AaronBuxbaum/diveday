import { z } from "zod";
import { getDb } from "@/db/client";
import { recordRollCall } from "@/db/manifests";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import type { RollCallCheckpoint } from "@/lib/manifests";

const eventSchema = z.object({
  clientEventId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  snapshotSavedAt: z.iso.datetime(),
  bookingId: z.string().uuid(),
  tripId: z.string().uuid(),
  checkpoint: z.union([z.literal("departure"), z.string().regex(/^after_dive_[1-6]$/)]),
  status: z.enum(["boarded", "not_boarded"]),
  note: z.string().trim().max(300).nullable(),
  occurredAt: z.iso.datetime(),
});

const bodySchema = z.object({ events: z.array(eventSchema).min(1).max(200) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "json_required" }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_events" }, { status: 400 });

  const db = await getDb();
  const sorted = [...parsed.data.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const results = [];
  for (const event of sorted) {
    const outcome = await recordRollCall(db, {
      shopId: session.user.shopId,
      tripId: event.tripId,
      bookingId: event.bookingId,
      recordedByPersonId: session.user.personId,
      status: event.status,
      checkpoint: event.checkpoint as RollCallCheckpoint,
      source: "offline",
      clientEventId: event.clientEventId,
      offlineSnapshotSavedAt: new Date(event.snapshotSavedAt),
      occurredAt: new Date(event.occurredAt),
      note: event.note ?? undefined,
    });
    results.push({
      clientEventId: event.clientEventId,
      status: outcome.ok ? (outcome.duplicate ? "duplicate" : "applied") : "rejected",
      ...(!outcome.ok ? { reason: outcome.reason } : {}),
    });
  }
  return Response.json({ results });
}
