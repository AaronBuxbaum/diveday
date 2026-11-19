import type { RollCallCheckpoint } from "@/lib/manifests";
import {
  offlineRollCallWitnessEnabled,
  verifyRollCallWitness,
} from "@/lib/offline-roll-call-witness";
import type { DbExecutor } from "./client";
import { reviewPersonIsCurrent } from "./offline-review-identity";
import { offlineFrontierMatches } from "./offline-roll-call-frontier";
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
  liveRecountProof?: { snapshotId: string; witness: string; meetingDay: number };
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
  if (source === "live" && offlineRollCallWitnessEnabled()) {
    const { causal, recount } = await manifestRollCallReads(tx, input.shopId, input.tripId);
    const key = recountScopeKey(
      input.shopId,
      input.tripId,
      input.bookingId,
      checkpoint,
      causal.meetingDay,
    );
    if (recount.has(key) && !input.reviewWitness) {
      const proof = input.liveRecountProof;
      if (!proof || proof.meetingDay !== causal.meetingDay) return { ok: false as const };
      const witness = verifyRollCallWitness(proof.witness, {
        shopId: input.shopId,
        tripId: input.tripId,
        snapshotId: proof.snapshotId,
        subjectKind: "seat",
        subjectId: input.bookingId,
        checkpoint,
        meetingDay: proof.meetingDay,
      });
      const frontier =
        causal.contexts.get(`seat:${input.bookingId.toLowerCase()}/${checkpoint}`)
          ?.observedEvidenceIds ?? [];
      if (
        !witness ||
        witness.meetingGeneration !== booking.offlineMeetingGeneration ||
        witness.assignmentGeneration !== booking.offlineAssignmentGeneration ||
        !witness.originalPersonId ||
        witness.originalPersonId !== booking.personId.toLowerCase() ||
        booking.identityUnconfirmedAt !== null ||
        JSON.stringify([...frontier].sort()) !== JSON.stringify(witness.frontier)
      )
        return { ok: false as const };
    }
  }
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
  const matchingFrontier =
    source === "offline"
      ? await offlineFrontierMatches(tx, {
          shopId: input.shopId,
          tripId: input.tripId,
          checkpoint,
          meetingDay: input.meetingDay,
          subject: { bookingId: input.bookingId },
          snapshotId: input.offlineSnapshotId,
          captured: witness.frontier,
          current: frontier,
          observed: input.observedEvidenceIds ?? [],
        })
      : JSON.stringify([...frontier].sort()) === JSON.stringify(witness.frontier) &&
        witness.frontier.every((id) => observed.has(id)) &&
        observed.size === witness.frontier.length;
  if (causal.meetingDay !== input.meetingDay || !matchingFrontier) return { ok: false as const };
  return { ok: true as const, witness };
}
