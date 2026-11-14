import { and, eq, sql } from "drizzle-orm";
import { offlineReceiptSecrets } from "@/lib/offline-receipt-secrets";
import { type RollCallIntent, rollCallIntentKey } from "@/lib/roll-call-causality";
import { deriveLabelKey, signPayload, tagMatches } from "@/lib/signed-token";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";
import { CLIENT_EVENT_CONFLICT } from "./offline-replay";
import { bookings, people, rollCallEventClaims } from "./schema";

type Subject = { kind: "seat"; bookingId: string } | { kind: "crew"; personId: string };
export type RollCallClaimInput = RollCallIntent & {
  shopId: string;
  tripId: string;
  clientEventId: string;
  recordedByPersonId: string;
  subject: Subject;
  offlineSnapshotId?: string;
  offlineMeetingIdentityProof?: string;
  offlineErasureEpochToken?: string;
  offlineSnapshotSavedAt?: Date;
  occurredAt?: Date;
  source?: "live" | "offline";
  note?: string | null;
};
type NoteDisposition = "discarded_erasure_cutoff" | "discarded_unverified_snapshot";
type UnresolvedReason = "meeting_identity_unverified" | "unresolved_predecessor";

// Do not retain raw observations until bounded retention, author lifecycle,
// and an authenticated review path have been verified.
const CAPTURE_UNRESOLVED_OBSERVATIONS = false;

/** Retain only notes whose existing rule can be established without guessing a meeting. */
export function capturableObservation(input: RollCallClaimInput, disposition?: NoteDisposition) {
  if (input.source !== "offline") return null;
  const checkpoint = input.checkpoint ?? "departure";
  const note = input.note?.trim() || null;
  if (note && !disposition && (checkpoint === "departure" || input.status !== "not_boarded"))
    return null;
  return {
    checkpoint,
    status: input.status,
    occurredAt: input.occurredAt?.toISOString() ?? null,
    snapshotId: input.offlineSnapshotId ?? null,
    snapshotSavedAt: input.offlineSnapshotSavedAt?.toISOString() ?? null,
    meetingDay: input.meetingDay ?? null,
    meetingProof: input.offlineMeetingIdentityProof ?? null,
    erasureToken: input.offlineErasureEpochToken ?? null,
    observedEvidenceIds: input.observedEvidenceIds ?? null,
    retractsEventId: input.retractsEventId ?? null,
    retractsClientEventId: input.retractsClientEventId ?? null,
    reconcilesEvidence: input.reconcilesEvidence === true,
    note: disposition ? null : note,
  };
}

function fingerprint(secret: string, label: string, fields: unknown[]): string {
  return signPayload(deriveLabelKey(secret, label), JSON.stringify(fields));
}

/** Keyed fingerprints bind note intent without retaining a second copy of the text. */
function fingerprints(input: RollCallClaimInput, secret = offlineReceiptSecrets()[0]) {
  const subject = input.subject.kind === "seat" ? input.subject.bookingId : input.subject.personId;
  const fields = [
    input.shopId.toLowerCase(),
    input.tripId.toLowerCase(),
    input.clientEventId.toLowerCase(),
    input.subject.kind,
    subject.toLowerCase(),
    rollCallIntentKey(input),
    input.source ?? "live",
    input.occurredAt?.toISOString() ?? null,
    input.offlineSnapshotSavedAt?.toISOString() ?? null,
    input.offlineErasureEpochToken ?? null,
  ];
  return {
    key: fingerprint(secret, "diveday-roll-call-claim-key-id-v1", ["roll-call-claim-v1"]),
    intent: fingerprint(secret, "diveday-roll-call-claim-intent-v1", [
      ...fields,
      input.note?.trim() || null,
    ]),
    withoutNote: fingerprint(secret, "diveday-roll-call-claim-without-note-v1", fields),
    proof: fingerprint(secret, "diveday-roll-call-claim-proof-v1", [
      input.shopId.toLowerCase(),
      input.tripId.toLowerCase(),
      input.clientEventId.toLowerCase(),
      input.offlineSnapshotId?.toLowerCase() ?? null,
      input.offlineMeetingIdentityProof ?? null,
    ]),
  };
}

/** Called after the shop erasure fence and before trip or seat locks. */
export async function lockRollCallClaimIdentities(tx: DbExecutor, input: RollCallClaimInput) {
  await boundLockWaits(tx);
  // A single shop lock serializes the current identity and all predecessors.
  // Sorting UUIDs before hashing is insufficient: hash collisions can reverse
  // the physical order and deadlock overlapping dependency sets.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('roll_call_event_claim'), hashtext(${input.shopId.toLowerCase()}))`,
  );
}

/** An erased claim is terminal; unresolved intent can never silently become accepted. */
export async function existingRollCallClaim(
  tx: DbExecutor,
  input: RollCallClaimInput,
): Promise<
  | undefined
  | { recheck: true; noteDisposition?: NoteDisposition }
  | { ok: true; eventId: string; duplicate: true; noteDisposition?: NoteDisposition }
  | {
      ok: false;
      reason:
        | "unresolved_predecessor"
        | "meeting_identity_unverified"
        | "claim_key_unavailable"
        | "client_event_conflict";
      noteDisposition?: NoteDisposition;
    }
> {
  const [claim] = await tx
    .select()
    .from(rollCallEventClaims)
    .where(
      and(
        eq(rollCallEventClaims.shopId, input.shopId),
        eq(rollCallEventClaims.clientEventId, input.clientEventId),
      ),
    )
    .limit(1);
  if (!claim) return undefined;
  if (claim.state === "erased")
    return { ok: false as const, reason: "unresolved_predecessor" as const };
  const expected = offlineReceiptSecrets()
    .map((secret) => fingerprints(input, secret))
    .find((candidate) => tagMatches(claim.keyFingerprint, candidate.key));
  // A rotated or unavailable key cannot prove a conflict. Keep the batch
  // pending until the original verification key is restored or migrated.
  if (!expected) return { ok: false as const, reason: "claim_key_unavailable" as const };
  const safelyDiscarded =
    claim.noteDisposition !== null &&
    !input.note?.trim() &&
    tagMatches(claim.intentWithoutNoteFingerprint, expected.withoutNote);
  if (
    (!tagMatches(claim.intentFingerprint, expected.intent) && !safelyDiscarded) ||
    !tagMatches(claim.proofFingerprint, expected.proof)
  )
    return { ok: false as const, reason: CLIENT_EVENT_CONFLICT };
  if (claim.state === "accepted") {
    if (!claim.acceptedEventId) throw new Error("Accepted roll-call claim has no event");
    const disposition = claim.noteDisposition;
    if (
      disposition !== null &&
      disposition !== "discarded_erasure_cutoff" &&
      disposition !== "discarded_unverified_snapshot"
    )
      throw new Error("Invalid roll-call note disposition");
    return {
      ok: true as const,
      eventId: claim.acceptedEventId,
      duplicate: true as const,
      ...(disposition ? { noteDisposition: disposition } : {}),
    };
  }
  if (
    claim.unresolvedReason !== "meeting_identity_unverified" &&
    claim.unresolvedReason !== "unresolved_predecessor"
  )
    throw new Error("Invalid unresolved roll-call claim");
  const noteDisposition = claim.noteDisposition;
  if (
    noteDisposition !== null &&
    noteDisposition !== "discarded_erasure_cutoff" &&
    noteDisposition !== "discarded_unverified_snapshot"
  )
    throw new Error("Invalid roll-call note disposition");
  if (claim.unresolvedReason === "unresolved_predecessor")
    return { recheck: true as const, ...(noteDisposition ? { noteDisposition } : {}) };
  return {
    ok: false as const,
    reason: claim.unresolvedReason,
    ...(noteDisposition ? { noteDisposition } : {}),
  };
}

export async function insertRollCallClaim(
  tx: DbExecutor,
  input: RollCallClaimInput,
  result:
    | { state: "accepted"; eventId: string; noteDisposition?: NoteDisposition }
    | { state: "unresolved"; reason: UnresolvedReason; noteDisposition?: NoteDisposition },
) {
  // The caller holds the identity lock and has already matched immutable
  // intent and proof. Only dependency deferrals may be re-evaluated.
  const changed = await tx
    .update(rollCallEventClaims)
    .set({
      reviewRevision: sql`gen_random_uuid()`,
      state: result.state,
      acceptedEventId: result.state === "accepted" ? result.eventId : null,
      unresolvedReason: result.state === "unresolved" ? result.reason : null,
      ...(result.noteDisposition ? { noteDisposition: result.noteDisposition } : {}),
      ...(result.state === "accepted" || result.noteDisposition
        ? {
            unresolvedObservation: null,
            unresolvedRecordedByPersonId: null,
            handoffReceiptId: null,
            handoffReceiptAt: null,
          }
        : {}),
    })
    .where(
      and(
        eq(rollCallEventClaims.shopId, input.shopId),
        eq(rollCallEventClaims.clientEventId, input.clientEventId),
        eq(rollCallEventClaims.state, "unresolved"),
        eq(rollCallEventClaims.unresolvedReason, "unresolved_predecessor"),
      ),
    )
    .returning({ id: rollCallEventClaims.id });
  if (changed.length) return;
  // Erasure takes the exclusive shop fence held shared by the caller. Check
  // again under that fence so an old device cannot recreate identifying
  // claim material after erasure completed.
  const rows =
    input.subject.kind === "seat"
      ? await tx
          .select({ erased: people.anonymizedAt })
          .from(bookings)
          .innerJoin(people, eq(people.id, bookings.personId))
          .where(
            and(
              eq(bookings.shopId, input.shopId),
              eq(bookings.tripId, input.tripId),
              eq(bookings.id, input.subject.bookingId),
              eq(people.shopId, input.shopId),
            ),
          )
          .limit(1)
      : await tx
          .select({ erased: people.anonymizedAt })
          .from(people)
          .where(
            // diveday:allow-deleted-people: by-id erasure check must see the removed subject to tombstone its claim.
            and(eq(people.shopId, input.shopId), eq(people.id, input.subject.personId)),
          )
          .limit(1);
  if (!rows[0]) throw new Error("Roll-call claim subject unavailable");
  if (rows[0].erased) {
    await tx.insert(rollCallEventClaims).values({
      shopId: input.shopId,
      tripId: input.tripId,
      clientEventId: input.clientEventId,
      state: "erased",
    });
    return;
  }
  const digest = fingerprints(input);
  const observation =
    CAPTURE_UNRESOLVED_OBSERVATIONS && result.state === "unresolved"
      ? capturableObservation(input, result.noteDisposition)
      : null;
  await tx.insert(rollCallEventClaims).values({
    shopId: input.shopId,
    tripId: input.tripId,
    clientEventId: input.clientEventId,
    subjectKind: input.subject.kind,
    bookingId: input.subject.kind === "seat" ? input.subject.bookingId : null,
    crewPersonId: input.subject.kind === "crew" ? input.subject.personId : null,
    intentFingerprint: digest.intent,
    intentWithoutNoteFingerprint: digest.withoutNote,
    proofFingerprint: digest.proof,
    keyFingerprint: digest.key,
    state: result.state,
    acceptedEventId: result.state === "accepted" ? result.eventId : null,
    unresolvedReason: result.state === "unresolved" ? result.reason : null,
    noteDisposition: result.noteDisposition ?? null,
    unresolvedObservation: observation,
    unresolvedRecordedByPersonId: observation ? input.recordedByPersonId : null,
  });
}
