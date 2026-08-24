import { z } from "zod";
import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { recordCrewRollCall, recordRollCall } from "@/db/manifests";
import { recordPreDepartureCheck } from "@/db/pre-departure-check";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import type { RollCallCheckpoint } from "@/lib/manifests";

/**
 * One event carries **exactly one** subject: a `bookingId` (a diver's paid
 * seat) or a `crewPersonId` (a rostered crew member's `people.id`). Both are
 * optional in the object and the pair is constrained by the refinement below,
 * rather than being a discriminated union on some `subject` tag — events
 * already sitting in a captain's IndexedDB were written with `bookingId` and
 * nothing else, and those are the ones that must still parse when they finally
 * reach signal. An unsynced event is a person somebody counted with no radio.
 *
 * Neither-or-both is refused rather than guessed at. A body naming no subject
 * is a claim about nobody, and one naming two is a claim the recorders cannot
 * both honour — either way there is no safe reading, and the batch is refused
 * as a whole (400) so its events stay `pending` on the device instead of being
 * marked settled and losing their hold against the next purge, exactly as the
 * auth gate below does for an unauthorized caller.
 */
const eventSchema = z
  .object({
    clientEventId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    snapshotSavedAt: z.iso.datetime(),
    bookingId: z.string().uuid().optional(),
    crewPersonId: z.string().uuid().optional(),
    tripId: z.string().uuid(),
    checkpoint: z.union([z.literal("departure"), z.string().regex(/^after_dive_[1-6]$/)]),
    /**
     * `cleared` is the retraction — "take that mark off, nobody said it" —
     * and it joined the offline vocabulary on 2026-08-15 (ADR
     * 20260815-offline-can-unsay-a-missing-diver). It grants a device no new
     * authority: `recordRollCall`/`recordCrewRollCall` have accepted it from
     * the live manifest since roll call had an undo, and an offline `cleared`
     * goes through the identical gauntlet every other offline status does —
     * dedup on `clientEventId`, the staleness bound, and the newest-wins
     * refusal, which is what stops a device that has been in a dry bag for an
     * hour erasing a mark another device recorded since.
     */
    status: z.enum(["boarded", "not_boarded", "cleared"]),
    /**
     * Which statement a `cleared` takes back — the `clientEventId` of the event
     * the device was actually looking at when somebody tapped undo (ADR
     * 20260815-an-offline-retraction-names-its-target). The writers apply the
     * retraction only while that event is still the newest one standing at this
     * subject and checkpoint, which is what stops an *honest, updated* device
     * holding a stale copy from unsaying a different device's "did not come back
     * from the dive".
     *
     * Honest and updated, and that is the whole of it: because the field is
     * optional (below), a caller that simply omits it still gets the old
     * newest-wins write. This is a correctness guard against staleness, **not an
     * authorization boundary**, and nothing downstream may treat it as one
     * (security review, 2026-08-15). Nobody gains anything by omitting it — the
     * caller is already live staff of this shop, who can issue the identical
     * `cleared` from the live manifest one tab away.
     *
     * **Optional, and its absence is not a loosening to be tidied up later.**
     * An event with no `retractsClientEventId` was queued by a build that
     * predates the field — a phone in a dry bag on a boat, which is the whole
     * reason this route exists — and it takes exactly the path it took before,
     * scoped on the device to that device's own statement
     * (`OfflineRollCallResult.local`). Refusing those would throw away roll call
     * a crew member really recorded, which is the one thing this route is built
     * never to do.
     *
     * A uuid because the device mints it with `crypto.randomUUID()`. Unlike
     * `clientEventId` above it never reaches Postgres — it is compared in
     * JavaScript, case-folded, against the newest row's `client_event_id`
     * (`offlineRetractionSuperseded`, src/db/manifests.ts) — so this rule is
     * shape validation and nothing more. Say so plainly, because the hazard
     * inverts if the comparison ever moves into SQL.
     */
    retractsClientEventId: z.string().uuid().optional(),
    note: z.string().trim().max(300).nullable(),
    occurredAt: z.iso.datetime(),
  })
  // No `message`: nothing here reaches a person. A failure of this refinement
  // is answered as the batch-level `{ error: "invalid_events" }` below, in the
  // same words a malformed body has always produced — a caller learns that the
  // batch was refused and nothing about which event or why.
  .refine((event) => (event.bookingId === undefined) !== (event.crewPersonId === undefined));

/**
 * A checklist tap. No subject refinement needed the way `eventSchema` has one
 * — `checklistItemId` is always the whole of the claim, never optional-and-
 * exclusive with a second field the way a roll-call event's diver/crew split
 * is.
 */
const checklistEventSchema = z.object({
  clientEventId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  snapshotSavedAt: z.iso.datetime(),
  tripId: z.string().uuid(),
  checklistItemId: z.string().uuid(),
  status: z.enum(["checked", "cleared"]),
  retractsClientEventId: z.string().uuid().optional(),
  note: z.string().trim().max(300).nullable(),
  occurredAt: z.iso.datetime(),
});

const bodySchema = z
  .object({
    events: z.array(eventSchema).max(200),
    checklistEvents: z.array(checklistEventSchema).max(200).optional(),
  })
  // A batch naming neither is refused rather than accepted as a no-op — the
  // caller always has at least one pending event when it POSTs at all
  // (`syncOfflineManifest`'s own guard), so an empty pair means a malformed
  // request, not a legitimately quiet device.
  .refine((body) => body.events.length + (body.checklistEvents?.length ?? 0) > 0);

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

  // Oldest first, and `sort` is stable — so two events sharing one `occurredAt`
  // keep the order the device queued them in and the later tap is applied last,
  // taking the later `created_at` that `desc(occurredAt), desc(createdAt)` reads
  // back first. That is the same tie-break `latestQueuedAttempt`
  // (src/lib/offline-manifests.ts) applies on the device, and the two have to
  // agree: a captain who marks the wrong row and corrects it within the same
  // millisecond must not watch the screen change back after a sync. Replacing
  // this with an unstable ordering, or sorting the payload anywhere else, breaks
  // that quietly.
  const sorted = [...parsed.data.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const results = [];
  for (const event of sorted) {
    // Everything except the subject column is identical, and both recorders
    // apply the same offline contract (dedup on `clientEventId`, the shared
    // staleness bound, newest-wins) — so the dispatch is the only thing that
    // branches here. `shopId` still comes straight off the session on both
    // paths; a crew event's `crewPersonId` is proven to be on *this* trip's
    // roster inside `recordCrewRollCall`'s own transaction.
    const common = {
      shopId: session.user.shopId,
      tripId: event.tripId,
      recordedByPersonId: session.user.personId,
      status: event.status,
      checkpoint: event.checkpoint as RollCallCheckpoint,
      source: "offline" as const,
      clientEventId: event.clientEventId,
      retractsClientEventId: event.retractsClientEventId,
      offlineSnapshotSavedAt: new Date(event.snapshotSavedAt),
      occurredAt: new Date(event.occurredAt),
      note: event.note ?? undefined,
    };
    const outcome = event.crewPersonId
      ? await recordCrewRollCall(db, { ...common, personId: event.crewPersonId })
      : event.bookingId
        ? await recordRollCall(db, { ...common, bookingId: event.bookingId })
        : // Unreachable: `eventSchema`'s refinement already refused an event
          // naming no subject. Written as a refusal rather than a cast or a
          // throw so that a future loosening of that refinement costs one
          // rejected event, not a 500 that takes the whole batch's evidence
          // with it — and never a `""` handed to a uuid comparison, which
          // Postgres raises on rather than coercing.
          { ok: false as const, reason: "invalid_subject" as const };
    results.push({
      clientEventId: event.clientEventId,
      status: outcome.ok ? (outcome.duplicate ? "duplicate" : "applied") : "rejected",
      ...(!outcome.ok ? { reason: outcome.reason } : {}),
    });
  }

  // Same ordering discipline as the roll-call loop above, applied to the
  // sibling array — oldest first, stable sort, so two taps on one item
  // sharing a timestamp still apply in the order this device queued them.
  const sortedChecklist = [...(parsed.data.checklistEvents ?? [])].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  );
  for (const event of sortedChecklist) {
    const outcome = await recordPreDepartureCheck(db, {
      shopId: session.user.shopId,
      tripId: event.tripId,
      checklistItemId: event.checklistItemId,
      recordedByPersonId: session.user.personId,
      status: event.status,
      source: "offline",
      clientEventId: event.clientEventId,
      retractsClientEventId: event.retractsClientEventId,
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
