import type { RollCallCheckpoint } from "@/lib/manifests";
import {
  offlineRollCallWitnessEnabled,
  verifyRollCallWitness,
} from "@/lib/offline-roll-call-witness";
import type { DbExecutor } from "./client";
import { reviewPersonIsCurrent } from "./offline-review-identity";
import { manifestRollCallReads, recountScopeKey } from "./roll-call-causal-store";

type Capture = {
  shopId: string;
  tripId: string;
  bookingId: string;
  source?: "live" | "offline";
  rollCallWitness?: string;
  reviewWitness?: string;
  offlineSnapshotId?: string;
  meetingDay?: number;
  reviewOriginalWitness?: string;
  reviewOriginalSnapshotId?: string;
  reviewOriginalMeetingDay?: number;
  observedEvidenceIds?: string[];
};
type Seat = {
  personId: string;
  identityUnconfirmedAt: Date | null;
  offlineMeetingGeneration: number;
  offlineAssignmentGeneration: number;
};

/** Validate the signed capture against the seat and causal frontier while their locks are held. */
export async function validateOfflineRollCallCapture(
  tx: DbExecutor,
  input: Capture,
  checkpoint: RollCallCheckpoint,
  booking: Seat,
) {
  const source = input.source ?? "live";
  if (source === "offline" && offlineRollCallWitnessEnabled() !== Boolean(input.rollCallWitness))
    return { ok: false as const };
  if (source === "live" && input.reviewWitness && !offlineRollCallWitnessEnabled())
    return { ok: false as const };
  const token = source === "offline" ? input.rollCallWitness : input.reviewWitness;
  if (!token) return { ok: true as const, witness: null };
  if (!input.offlineSnapshotId || input.meetingDay === undefined) return { ok: false as const };
  const witness = verifyRollCallWitness(token, {
    shopId: input.shopId,
    tripId: input.tripId,
    snapshotId: input.offlineSnapshotId,
    subjectKind: "seat",
    subjectId: input.bookingId,
    checkpoint,
    meetingDay: input.meetingDay,
  });
  if (
    !witness ||
    witness.meetingGeneration !== booking.offlineMeetingGeneration ||
    witness.assignmentGeneration !== booking.offlineAssignmentGeneration
  )
    return { ok: false as const };
  if (source === "live" && input.reviewWitness) {
    const original =
      input.reviewOriginalSnapshotId && input.reviewOriginalMeetingDay !== undefined
        ? verifyRollCallWitness(input.reviewOriginalWitness, {
            shopId: input.shopId,
            tripId: input.tripId,
            snapshotId: input.reviewOriginalSnapshotId,
            subjectKind: "seat",
            subjectId: input.bookingId,
            checkpoint,
            meetingDay: input.reviewOriginalMeetingDay,
          })
        : null;
    if (
      !original?.originalPersonId ||
      original.originalPersonId !== witness.originalPersonId ||
      original.assignmentGeneration !== witness.assignmentGeneration ||
      !(await reviewPersonIsCurrent(
        tx,
        input.shopId,
        booking.personId,
        booking.identityUnconfirmedAt,
        witness.originalPersonId,
      ))
    )
      return { ok: false as const };
  }
  const { causal, recount } = await manifestRollCallReads(tx, input.shopId, input.tripId);
  if (
    source === "offline" &&
    recount.has(
      recountScopeKey(input.shopId, input.tripId, input.bookingId, checkpoint, input.meetingDay),
    )
  )
    return { ok: false as const };
  const frontier =
    causal.contexts.get(`seat:${input.bookingId}/${checkpoint}`)?.observedEvidenceIds ?? [];
  const observed = new Set((input.observedEvidenceIds ?? []).map((id) => id.toLowerCase()));
  if (
    causal.meetingDay !== input.meetingDay ||
    JSON.stringify([...frontier].sort()) !== JSON.stringify(witness.frontier) ||
    witness.frontier.some((id) => !observed.has(id)) ||
    (source === "live" && observed.size !== witness.frontier.length)
  )
    return { ok: false as const };
  return { ok: true as const, witness };
}
