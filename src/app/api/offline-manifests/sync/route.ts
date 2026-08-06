import { z } from "zod";
import { loadActiveStaffRoles } from "@/db/authz";
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

/**
 * Apply roll-call events a boat tablet recorded while it was offline.
 *
 * The only *write* among the staff API routes, and what it writes is the record
 * of who came back from a dive — so its gate is the strictest of the set: live
 * roles, re-read on every request, before the body is so much as read.
 */
export async function POST(request: Request) {
  const session = await auth();
  // A pre-filter, not the gate. Deliberately ahead of any database work so a
  // caller with no session — or a token that never claimed a staff role — is
  // refused without costing a connection (there is a test asserting `getDb` is
  // never reached on this path). The roles it reads are whatever the JWT was
  // stamped with at sign-in, which is exactly why it cannot be the last word.
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const db = await getDb();

  // The gate that decides: live roles, re-read on every request. No `maxAge` is
  // set on the session (src/lib/auth.config.ts), so NextAuth's 30-day default
  // applies — a staffer removed from this shop this morning still carries
  // `captain` in their token for a month, and `/api/**` is outside the edge gate
  // (src/proxy.ts), so this handler is the only wall. `loadActiveStaffRoles`
  // exists for that window (ADR 20260724-role-authorization): it is null for a
  // deleted person, a disabled account, or someone who was never this shop's,
  // and the roles it does return are the `person_roles` of right now.
  //
  // `recordRollCall` does re-check staff-ness inside its own transaction, but it
  // is a weaker check by design — it joins `person_roles` and stops there, so a
  // deleted person or a disabled account with a stale role row still writes the
  // row. That is the whole reason this cannot be left to the writer.
  //
  // Unlike the sibling read routes there is no tenant row read to sequence
  // against: `shopId` comes straight off the session and is handed to
  // `recordRollCall` as-is, so nothing here can turn a legitimate 404 into a 401.
  // The gate therefore sits as early as a database is available — ahead of the
  // content-type and schema checks, so an unauthorized caller's body is never
  // read, let alone parsed into 200 events. A refused caller learns only that
  // they are refused; a well-formed batch and a malformed one get the same 401.
  //
  // Refusing the *request* rather than each event is also what preserves the
  // evidence on the device. `syncOfflineManifest` throws on any non-ok response
  // and writes nothing back, so the envelope's events stay `pending` and the
  // browser retries the sync tag later; a per-event `rejected` result would mark
  // them settled, and a settled event no longer holds its record alive against
  // the next purge (ADR 20260726-shopwide-offline-manifest-priming). Roll call
  // is the record of who came back from a dive — losing it is worse than
  // refusing to apply it.
  const roles = await loadActiveStaffRoles(db, session.user.shopId, session.user.personId);
  if (!roles || !isStaff(roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "json_required" }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_events" }, { status: 400 });

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
