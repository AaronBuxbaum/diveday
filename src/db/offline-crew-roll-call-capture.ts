import {
  offlineRollCallWitnessEnabled,
  verifyRollCallWitness,
} from "@/lib/offline-roll-call-witness";
import type { DbExecutor } from "./client";
import { offlineFrontierMatches } from "./offline-roll-call-frontier";
import {
  manifestRollCallReads,
  recountApplies,
  recountHasUnknownDay,
} from "./roll-call-causal-store";

type CrewContext = {
  shopId: string;
  tripId: string;
  personId: string;
  checkpoint: string;
  meetingGeneration: number;
  incarnation: string;
};
type Proof = { snapshotId: string; witness: string; meetingDay: number };

/** Authenticate the context rendered to a live crew counter while the trip is locked. */
export async function liveCrewCaptureValid(
  db: DbExecutor,
  input: CrewContext,
  proof?: Proof,
  meetingDay?: number,
): Promise<boolean> {
  if (!offlineRollCallWitnessEnabled()) return true;
  const { causal, recount } = await manifestRollCallReads(db, input.shopId, input.tripId);
  const unknownDay = recountHasUnknownDay(
    recount,
    input.shopId,
    input.tripId,
    `crew:${input.personId}`,
  );
  const requires = recountApplies(
    recount,
    input.shopId,
    input.tripId,
    `crew:${input.personId}`,
    input.checkpoint,
    causal.meetingDay,
  );
  if (!requires && !unknownDay && !proof) return true;
  if (!proof || proof.meetingDay !== causal.meetingDay || meetingDay !== proof.meetingDay)
    return false;
  const witness = verifyRollCallWitness(proof.witness, {
    shopId: input.shopId,
    tripId: input.tripId,
    snapshotId: proof.snapshotId,
    subjectKind: "crew",
    subjectId: input.personId,
    checkpoint: input.checkpoint,
    meetingDay: proof.meetingDay,
  });
  const frontier =
    causal.contexts.get(`crew:${input.personId.toLowerCase()}/${input.checkpoint}`)
      ?.observedEvidenceIds ?? [];
  return (
    !!witness &&
    witness.meetingGeneration === input.meetingGeneration &&
    witness.originalPersonId === input.incarnation.toLowerCase() &&
    JSON.stringify([...frontier].sort()) === JSON.stringify(witness.frontier)
  );
}

/** Verify an offline crew witness before its capture can be considered for replay. */
export function offlineCrewWitness(input: CrewContext, proof?: Proof) {
  if (!proof) return null;
  const witness = verifyRollCallWitness(proof.witness, {
    shopId: input.shopId,
    tripId: input.tripId,
    snapshotId: proof.snapshotId,
    subjectKind: "crew",
    subjectId: input.personId,
    checkpoint: input.checkpoint,
    meetingDay: proof.meetingDay,
  });
  return witness &&
    witness.meetingGeneration === input.meetingGeneration &&
    witness.originalPersonId === input.incarnation.toLowerCase()
    ? witness
    : null;
}

/** A current offline frontier may advance only through observed descendants of this signed copy. */
export async function offlineCrewFrontierValid(
  db: DbExecutor,
  input: CrewContext & {
    snapshotId: string;
    meetingDay: number;
    captured: readonly string[];
    observed: readonly string[];
  },
): Promise<boolean> {
  const { causal, recount } = await manifestRollCallReads(db, input.shopId, input.tripId);
  if (
    causal.meetingDay !== input.meetingDay ||
    recountApplies(
      recount,
      input.shopId,
      input.tripId,
      `crew:${input.personId}`,
      input.checkpoint,
      input.meetingDay,
    )
  )
    return false;
  const current =
    causal.contexts.get(`crew:${input.personId.toLowerCase()}/${input.checkpoint}`)
      ?.observedEvidenceIds ?? [];
  return offlineFrontierMatches(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    checkpoint: input.checkpoint,
    meetingDay: input.meetingDay,
    subject: { personId: input.personId },
    snapshotId: input.snapshotId,
    captured: input.captured,
    current,
    observed: input.observed,
  });
}
