import { z } from "zod";
import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { recordCrewRollCall, recordRollCall } from "@/db/manifests";
import { recordPreDepartureCheck } from "@/db/pre-departure-check";
import { getShopById } from "@/db/shops";
import { offlineSyncTripsBelongToShop } from "@/db/trips";
import { checkInBooking, undoCheckInBooking } from "@/features/check-in";
import {
  buildOfflineManifestCopies,
  latestOfflineManifestSnapshotRevisions,
  offlineSyncInstants,
} from "@/features/offline-manifest-snapshots";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { log } from "@/lib/log";
import { ROLL_CALL_NOTE_MAX, type RollCallCheckpoint } from "@/lib/manifests";
import type { OfflineManifestUpcomingResponse } from "@/lib/offline-manifests";
import { ROLL_CALL_EVENT_STATUSES } from "@/lib/roll-call";
import {
  causalReplayOrder,
  clientRollCallEvidenceId,
  rollCallEvidenceIdPattern,
} from "@/lib/roll-call-causality";
import {
  OFFLINE_UNRESOLVED_HEADER,
  OFFLINE_UNRESOLVED_VERSION,
  supportsCausalRollCall,
} from "@/lib/roll-call-protocol";

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
    observedEvidenceIds: z.array(z.string().regex(rollCallEvidenceIdPattern)).max(200).optional(),
    reconcilesEvidence: z.boolean().optional(),
    meetingDay: z.number().int().min(0).optional(),
    meetingIdentityProof: z.string().max(128).optional(),
    snapshotId: z.string().uuid(),
    snapshotSavedAt: z.iso.datetime(),
    erasureEpochToken: z.string().max(128).optional(),
    bookingId: z.string().uuid().optional(),
    crewPersonId: z.string().uuid().optional(),
    tripId: z.string().uuid(),
    checkpoint: z.union([z.literal("departure"), z.string().regex(/^after_dive_[1-6]$/)]),
    /**
     * `cleared` is the retraction — "take that mark off, nobody said it" —
     * and it joined the offline vocabulary on 2026-08-15 (ADR
     * 20260815-offline-can-unsay-a-missing-diver). It grants a device no new
     * authority: `recordRollCall`/`recordCrewRollCall` have accepted it from
     * the live manifest since roll call had an undo. Offline retractions retain
     * their tap identity and exact target, while the shared causal projection
     * preserves other evidence the crew did not take back. Arrival order and
     * device clocks cannot turn an undo into a new observation (ADR
     * 20261112-roll-call-observes-evidence).
     */
    status: z.enum(ROLL_CALL_EVENT_STATUSES),
    /**
     * Which statement a `cleared` takes back — the `clientEventId` of the event
     * the device was actually looking at when somebody tapped undo (ADR
     * 20260815-an-offline-retraction-names-its-target). The writers validate the
     * target against this tenant, trip, subject and checkpoint, then require it
     * to remain in the causal frontier. Taking back one statement never takes
     * back another device's independent missing report. This is a correctness
     * contract, not an authorization boundary: the caller must already be live
     * staff of this shop.
     *
     * Optional for retained queues. Without captured causal context or a named
     * target, an after-dive retraction is refused as `retraction_superseded`
     * (issue #3951). An opaque departure retraction proves no relation either:
     * the causal projection cannot invent its target or remove another
     * statement. Updated ordinary undo names a standing target; deliberate
     * reconciliation is a separate explicit intent.
     *
     * A UUID because the device mints it with `crypto.randomUUID()`. Shape
     * validation here does not establish the target relation; the scoped writer
     * resolves and retains that exact relation, including its original target
     * form for replay validation.
     */
    retractsClientEventId: z.string().uuid().optional(),
    /**
     * What the crew observed about a person who is unaccounted for (ADR
     * 20260828-a-missing-diver-gets-a-sentence). **Optional**, and its absence
     * carries no meaning at all: most events are an ordinary "aboard" with
     * nothing to say, and an event queued by a build that predates the field
     * takes exactly the path it took before — the same rule
     * `retractsClientEventId` above states, for the same dry-bag reason.
     *
     * The writers keep it only at an after-dive checkpoint
     * (`rollCallNoteAllowed`), so a device cannot put free text on a departure
     * event either.
     */
    note: z.string().trim().max(ROLL_CALL_NOTE_MAX).nullish(),
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
  erasureEpochToken: z.string().max(128).optional(),
  tripId: z.string().uuid(),
  checklistItemId: z.string().uuid(),
  status: z.enum(["checked", "cleared"]),
  retractsClientEventId: z.string().uuid().optional(),
  note: z.string().trim().max(ROLL_CALL_NOTE_MAX).nullable(),
  occurredAt: z.iso.datetime(),
});

/**
 * One tap at the counter (ADR 20260907-the-counter-survives-offline).
 *
 * **There is no `checkpoint` and no `boarded` here, and that is the whole
 * point.** An arrival says a diver reached the desk; only a person at the rail
 * says one is on the boat. The two vocabularies never meet: this array is
 * dispatched below to `checkInBooking`/`undoCheckInBooking`, which write
 * the arrival trail (`booking_arrival_events`) alone and cannot reach
 * `roll_call_events` — so there is no value a device can put in this body,
 * well-formed or not, that promotes an arrival into a boarding.
 */
const arrivalEventSchema = z.object({
  clientEventId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  snapshotSavedAt: z.iso.datetime(),
  tripId: z.string().uuid(),
  bookingId: z.string().uuid(),
  status: z.enum(["arrived", "cleared"]),
  /** Which arrival a `cleared` takes back — see `retractsClientEventId` above. */
  retractsClientEventId: z.string().uuid().optional(),
  occurredAt: z.iso.datetime(),
});

const bodySchema = z
  .object({
    /** Optimistic tenant fence; session/shop ownership checks below remain authoritative. */
    expectedShopSlug: z.string().min(1).max(64).optional(),
    includeStoredInstants: z.literal(true).optional(),
    includeCausalSnapshots: z.literal(true).optional(),
    refreshTripId: z.string().uuid().optional(),
    events: z.array(eventSchema).max(200),
    checklistEvents: z.array(checklistEventSchema).max(200).optional(),
    arrivalEvents: z.array(arrivalEventSchema).max(200).optional(),
    /** Previously refused local predecessors; this can only defer, never authorize a write. */
    // At most 200 events can each reference 200 predecessors. The client
    // sends only referenced refusals; keeping that same bound avoids starving
    // an unrelated event when the union exceeds one event's 200-id limit.
    refusedEvidenceIds: z.array(z.string().regex(rollCallEvidenceIdPattern)).max(40_000).optional(),
  })
  // A quiet shell may request one tenant-owned fresh snapshot. Otherwise a
  // request needs queued evidence; snapshot refresh cannot mix other trips.
  .refine(
    (body) =>
      body.events.length + (body.checklistEvents?.length ?? 0) + (body.arrivalEvents?.length ?? 0) >
        0 ||
      (body.includeCausalSnapshots === true && body.refreshTripId !== undefined),
  )
  // Result receipts are keyed by client ID across all three queues. Refuse a
  // corrupt or colliding batch before any writer can settle the wrong event.
  .refine((body) => {
    const ids = [
      ...body.events,
      ...(body.checklistEvents ?? []),
      ...(body.arrivalEvents ?? []),
    ].map((event) => event.clientEventId.toLowerCase());
    return new Set(ids).size === ids.length;
  })
  .refine(
    (body) =>
      !body.includeCausalSnapshots ||
      (body.refreshTripId !== undefined &&
        [...body.events, ...(body.checklistEvents ?? []), ...(body.arrivalEvents ?? [])].every(
          (event) => event.tripId === body.refreshTripId,
        )),
  );

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

  // The gate that decides: live roles, re-read on every request. The session
  // sets no `expiresIn` (src/lib/auth.ts), so Better Auth's seven-day default
  // applies, renewed while it is in use — a staffer removed from this shop this
  // morning can still carry `captain` in their session for days, and `/api/**`
  // is outside the edge gate (src/proxy.ts), so this handler is the only wall.
  // `loadActiveStaffRoles` exists for that window (ADR
  // 20260724-role-authorization): it is null for a deleted person, a disabled
  // account, or someone who was never this shop's, and the roles it does return
  // are the `person_roles` of right now.
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

  if (!supportsCausalRollCall(request))
    return Response.json(
      { error: "offline_update_required" },
      { status: 426, headers: { "Cache-Control": "no-store" } },
    );
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "json_required" }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_events" }, { status: 400 });

  // A tab or service worker can start syncing while shop A is verified, then
  // complete its request after the browser signs into shop B. Refuse the
  // entire batch before any writer runs: per-event `rejected` results settle
  // device events and can make the next cross-shop purge delete A's only local
  // evidence. The slug is only a change detector; the authenticated session
  // and trip ownership query below are the authority.
  if (parsed.data.expectedShopSlug && parsed.data.expectedShopSlug !== session.user.shopSlug) {
    return Response.json({ error: "shop_changed" }, { status: 409 });
  }
  const tripIds = [
    ...new Set([
      ...(parsed.data.refreshTripId ? [parsed.data.refreshTripId] : []),
      ...parsed.data.events.map((event) => event.tripId),
      ...(parsed.data.checklistEvents ?? []).map((event) => event.tripId),
      ...(parsed.data.arrivalEvents ?? []).map((event) => event.tripId),
    ]),
  ];
  if (!(await offlineSyncTripsBelongToShop(db, session.user.shopId, tripIds))) {
    // Unknown and foreign trip ids receive the same response; neither reveals
    // whether another shop owns the id, and neither settles queued evidence.
    return Response.json({ error: "events_unavailable" }, { status: 404 });
  }

  // Captured predecessors precede their observers, independently of clocks
  // and payload order. Unobserved compatible facts merge; opposition persists.
  const sorted = causalReplayOrder(parsed.data.events);
  const results = [];
  const unresolved = new Set((parsed.data.refusedEvidenceIds ?? []).map((id) => id.toLowerCase()));
  const batchIds = new Set(sorted.map((event) => clientRollCallEvidenceId(event.clientEventId)));
  const accepted = new Set<string>();
  const supportsUnresolved =
    request.headers.get(OFFLINE_UNRESOLVED_HEADER) === OFFLINE_UNRESOLVED_VERSION;
  for (const event of sorted) {
    const ownId = clientRollCallEvidenceId(event.clientEventId);
    const predecessors = [
      ...(event.observedEvidenceIds ?? []).map((id) => id.toLowerCase()),
      ...(event.retractsClientEventId
        ? [clientRollCallEvidenceId(event.retractsClientEventId)]
        : []),
    ];
    const offlinePredecessorRefused = predecessors.some(
      (id) => id !== ownId && (unresolved.has(id) || (batchIds.has(id) && !accepted.has(id))),
    );
    // Everything except the subject column is identical, and both recorders
    // apply the same causal contract (stable identity, captured basis and
    // exact named targets) — so the dispatch is the only thing that
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
      offlinePredecessorRefused,
      observedEvidenceIds: event.observedEvidenceIds,
      reconcilesEvidence: event.reconcilesEvidence,
      meetingDay: event.meetingDay,
      offlineMeetingIdentityProof: event.meetingIdentityProof,
      offlineSnapshotId: event.snapshotId,
      offlineErasureEpochToken: event.erasureEpochToken,
      retractsClientEventId: event.retractsClientEventId,
      note: event.note,
      offlineSnapshotSavedAt: new Date(event.snapshotSavedAt),
      occurredAt: new Date(event.occurredAt),
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
    // A role can change after the route gate. A request-level refusal leaves
    // every device event pending; earlier commits retry under the same IDs.
    if (!outcome.ok && outcome.reason === "staff_not_found")
      return Response.json(
        { error: "authentication_required" },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    if (!outcome.ok && outcome.reason === "claim_key_unavailable")
      return Response.json(
        { error: "sync_unavailable" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    if (
      !outcome.ok &&
      (outcome.reason === "booking_unavailable" ||
        outcome.reason === "meeting_identity_unverified" ||
        outcome.reason === "unresolved_predecessor" ||
        outcome.reason === "client_event_conflict")
    ) {
      // A 409 keeps the batch pending locally; do not settle an ambiguous
      // physical observation as an ordinary rejected event.
      if (!supportsUnresolved)
        return Response.json(
          { error: outcome.reason },
          { status: 409, headers: { "Cache-Control": "private, no-store" } },
        );
      unresolved.add(clientRollCallEvidenceId(event.clientEventId));
      results.push({
        clientEventId: event.clientEventId,
        status: "unresolved" as const,
        reason: outcome.reason,
        ...(outcome.noteDisposition ? { noteDisposition: outcome.noteDisposition } : {}),
      });
      continue;
    }
    if (outcome.ok) accepted.add(ownId);
    results.push({
      clientEventId: event.clientEventId,
      status: outcome.ok ? (outcome.duplicate ? "duplicate" : "applied") : "rejected",
      ...(!outcome.ok ? { reason: outcome.reason } : {}),
      ...("noteDisposition" in outcome && outcome.noteDisposition
        ? { noteDisposition: outcome.noteDisposition }
        : {}),
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
      offlineSnapshotId: event.snapshotId,
      offlineErasureEpochToken: event.erasureEpochToken,
      occurredAt: new Date(event.occurredAt),
      note: event.note ?? undefined,
    });
    if (!outcome.ok && outcome.reason === "staff_not_found")
      return Response.json(
        { error: "authentication_required" },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    if (!outcome.ok && outcome.reason === "client_event_conflict")
      return Response.json(
        { error: "client_event_conflict" },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    results.push({
      clientEventId: event.clientEventId,
      status: outcome.ok ? (outcome.duplicate ? "duplicate" : "applied") : "rejected",
      ...(!outcome.ok ? { reason: outcome.reason } : {}),
      ...("noteDisposition" in outcome && outcome.noteDisposition
        ? { noteDisposition: outcome.noteDisposition }
        : {}),
    });
  }
  // The counter's own array, applied last and by the same ordering discipline:
  // oldest first, stable sort, so two taps on one seat sharing a timestamp
  // still apply in the order the device queued them.
  //
  // **The dispatch is on status and nothing else, and both branches are the
  // functions the live counter itself calls.** An offline arrival takes the
  // identical staff gate, trip and booking checks and — the one that matters —
  // the same *live* readiness re-read a staffer at the desk takes, hours after
  // the tap. Neither branch can write a roll-call row, which is what makes
  // "the queue never promotes an arrival to aboard" a property of the code
  // rather than a rule somebody has to keep.
  const sortedArrivals = [...(parsed.data.arrivalEvents ?? [])].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  );
  for (const event of sortedArrivals) {
    const common = {
      shopId: session.user.shopId,
      bookingId: event.bookingId,
      recordedByPersonId: session.user.personId,
      source: "offline" as const,
      clientEventId: event.clientEventId,
      offlineSnapshotSavedAt: new Date(event.snapshotSavedAt),
      occurredAt: new Date(event.occurredAt),
      expectedTripId: event.tripId,
    };
    const outcome =
      event.status === "arrived"
        ? await checkInBooking(db, common)
        : await undoCheckInBooking(db, {
            ...common,
            retractsClientEventId: event.retractsClientEventId,
          });
    if (!outcome.ok && outcome.reason === "staff_not_found")
      return Response.json(
        { error: "authentication_required" },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    results.push({
      clientEventId: event.clientEventId,
      status: outcome.ok ? (outcome.duplicate ? "duplicate" : "applied") : "rejected",
      ...(!outcome.ok ? { reason: outcome.reason } : {}),
    });
  }

  // Read after every writer above has committed, which is the whole of its
  // meaning: a copy two revisions past this one has seen these events
  // (`latestOfflineManifestSnapshotRevisions`). The events are already
  // written, so a failed read costs the device this hint and never the batch.
  let snapshotRevisions: Record<string, number> | undefined;
  try {
    snapshotRevisions = await latestOfflineManifestSnapshotRevisions(
      db,
      session.user.shopId,
      tripIds,
    );
  } catch (error) {
    log("offline_sync.snapshot_revisions_unread", "error", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  // A failed read fails the request; pending evidence retries with the same ids.
  // A duplicate must return the original committed instant, never a retry's clock.
  const stored = parsed.data.includeStoredInstants
    ? await offlineSyncInstants(
        db,
        session.user.shopId,
        results
          .filter((result) => result.status === "applied" || result.status === "duplicate")
          .map((result) => result.clientEventId),
      )
    : new Map<string, string>();
  // A success receipt must also tell the sending device the current roster
  // and frontier, under the same erasure/medical-viewer gates as priming.
  // Failure leaves the request unacknowledged; retries keep original IDs.
  let refreshedManifests: OfflineManifestUpcomingResponse | undefined;
  if (parsed.data.includeCausalSnapshots) {
    const shop = await getShopById(db, session.user.shopId);
    if (!shop) return Response.json({ error: "events_unavailable" }, { status: 404 });
    refreshedManifests = await buildOfflineManifestCopies(db, shop, session.user.personId, tripIds);
    if (refreshedManifests.payloads.length !== tripIds.length) {
      return Response.json({ error: "refresh_unavailable" }, { status: 503 });
    }
  }
  return Response.json(
    {
      results: results.map((result) => ({
        ...result,
        ...(stored.has(result.clientEventId)
          ? { storedOccurredAt: stored.get(result.clientEventId) }
          : {}),
      })),
      ...(snapshotRevisions ? { snapshotRevisions } : {}),
      ...(refreshedManifests ? { refreshedManifests } : {}),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
