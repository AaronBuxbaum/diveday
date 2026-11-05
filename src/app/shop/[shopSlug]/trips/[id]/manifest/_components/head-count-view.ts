import {
  passengersAboveCertificateAboard,
  personsAboveTotalPersonsAboard,
} from "@/lib/boat-safety";
import {
  blockedAtDock,
  isTurnedAwayOffBoat,
  type RollCallCheckpoint,
  rollCallRowState,
  splitBuddyTeamIds,
  type TripManifest,
} from "@/lib/manifests";
import {
  inAfterDivePopulation,
  type RollCallState as PopulationState,
} from "@/lib/roll-call-population";

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
    // Everyone aboard, crew included, against the certificate's total persons
    // (dive-domain review D2). A crew member recorded ashore is not aboard.
    overTotalPersons: personsAboveTotalPersonsAboard(
      manifest.summary.boarded +
        manifest.crew.filter((member) => rollCallRowState(checkpoint, member.rollCall).boarded)
          .length,
      manifest.trip.certifiedTotalPersons,
    ),
  };
}

/**
 * **What the deck count is held against** (loop 5, row 1;
 * `src/lib/deck-count.ts`): the passengers this checkpoint expects aboard,
 * how many carry an aboard mark, who carries no mark at all, who is recorded
 * not back aboard, and when the newest mark here was made.
 *
 * `expected` is the head count's own denominator, read off the rows rather
 * than the summary so the names and the number come from one pass: every seat
 * the boat counts (`isTurnedAwayOffBoat` aside), less whoever is settled
 * ashore (a dock "not boarded", or one carried forward after a dive) and a
 * seat the desk released that nobody at the boat has spoken for. A diver
 * recorded not back aboard stays expected: that is the head the deck is
 * missing.
 *
 * **After a dive the population is who boarded** (dock review S3): a no-show
 * the crew never tapped at the dock, and never named since, is an unfinished
 * dock count and not a head at sea (`inAfterDivePopulation`, the predicate
 * Today and the gap reader use). `manifests` is every checkpoint's manifest,
 * departure first; without it the after-dive population cannot be read and
 * the dock's rule stands.
 */
export function deckCountFacts(
  manifest: TripManifest,
  checkpoint: RollCallCheckpoint,
  manifests: readonly TripManifest[] = [],
) {
  const afterDive = checkpoint !== "departure" && manifests.length > 0;
  const statesBySeat = new Map<string, PopulationState[]>();
  for (const [index, sheet] of manifests.entries()) {
    for (const diver of sheet.divers) {
      const states = statesBySeat.get(diver.bookingId) ?? [];
      // A carried-forward result is nobody's word at that checkpoint: a hole.
      const word = diver.rollCall && diver.rollCall.implied !== true ? diver.rollCall.state : null;
      if (word === "boarded" || word === "not_boarded") states[index] = word;
      statesBySeat.set(diver.bookingId, states);
    }
  }
  const counted = manifest.divers.filter(
    (diver) =>
      !isTurnedAwayOffBoat(diver) &&
      (!afterDive || inAfterDivePopulation(statesBySeat.get(diver.bookingId) ?? [])),
  );
  const expected = counted.filter((diver) => {
    const state = rollCallRowState(checkpoint, diver.rollCall);
    if (state.explicitNotBoarded || state.impliedNotBoarded) return false;
    return !(diver.notHere && !diver.rollCall);
  });
  // The newest word anybody said at this checkpoint, diver or crew: a count
  // older than it is stale (dock review M2).
  const markTimes = [...manifest.divers, ...manifest.crew]
    .flatMap((person) =>
      person.rollCall && person.rollCall.implied !== true ? [person.rollCall.occurredAt] : [],
    )
    .map((at) => new Date(at).getTime());
  return {
    expected: expected.length,
    markedAboard: counted.filter((diver) => diver.rollCall?.state === "boarded").length,
    unmarked: counted
      .filter((diver) => !diver.rollCall && !diver.notHere)
      .map((diver) => diver.fullName),
    notBackAboard: counted
      .filter((diver) => rollCallRowState(checkpoint, diver.rollCall).notBackAboard)
      .map((diver) => diver.fullName),
    latestMarkAt: markTimes.length > 0 ? new Date(Math.max(...markTimes)) : null,
  };
}
