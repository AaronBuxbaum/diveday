import { passengersAboveCertificateAboard } from "@/lib/boat-safety";
import {
  blockedAtDock,
  type RollCallCheckpoint,
  rollCallRowState,
  splitBuddyTeamIds,
  type TripManifest,
} from "@/lib/manifests";

/**
 * **What the count panel says beside its number**: how many buddy teams are
 * split, who is recorded not back aboard — by name, divers and crew — the
 * blocked divers at the dock, and whether the passengers aboard pass the
 * boat's certificate. One derivation, so the panel's names and its
 * counts can never disagree with the rows below it.
 */
export function headCountView({
  manifest,
  checkpoint,
  isDeparture,
}: {
  /** This checkpoint's manifest, held seats already withheld. */
  manifest: TripManifest;
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
}) {
  // A count of split *teams*, not of rows wearing an alert: a team of four
  // with three back puts the alert on three rows, and the line says "N teams
  // are split" (`splitBuddyTeamIds`, src/lib/manifests.ts).
  const separatedTeams = isDeparture ? 0 : splitBuddyTeamIds(manifest, "separated_after_dive").size;
  // The other half of the same question, and the graver one: who has a stated
  // "did not come back" against their name. Read through `rollCallRowState`,
  // the one predicate the rows, the completeness verdict and the work queue
  // all share, so the panel's names and its counts can never disagree.
  const missingDivers = manifest.divers.filter(
    (diver) => rollCallRowState(checkpoint, diver.rollCall).notBackAboard,
  );
  const missingCrew = manifest.crew.filter(
    (member) => rollCallRowState(checkpoint, member.rollCall).notBackAboard,
  );
  return {
    separatedTeams,
    notBackAboardDivers: missingDivers.map((diver) => ({
      bookingId: diver.bookingId,
      fullName: diver.fullName,
    })),
    notBackAboardCrew: missingCrew.map((member) => ({
      id: member.id,
      fullName: member.fullName,
    })),
    blockedAtDock: blockedAtDock(manifest.divers),
    // The people the crew counted aboard at this checkpoint, held against the
    // boat's certificate (batch 6, item 2). Divers, snorkelers and riders —
    // passengers, which is what the certificate counts; never the crew.
    overCertificate: passengersAboveCertificateAboard(
      manifest.summary.boarded,
      manifest.trip.certifiedPassengers,
    ),
  };
}
