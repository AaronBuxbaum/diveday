import { personsAboveTotalPersonsAboard } from "@/lib/boat-safety";
import { counterIsDone, isSettledAtCounter } from "@/lib/check-in";
import { keepUnitsWhole } from "@/lib/date-parts";
import { cachedFormatter } from "@/lib/intl-cache";
import {
  boardedBefore,
  isNotBackAboard,
  isTurnedAwayOffBoat,
  medicalHoldAfterDive,
  type RollCallCheckpoint,
  rollCallCheckpointOrdinal,
  rollCallCompleteness,
  blockedAtRail as rowBlockedAtRail,
} from "@/lib/manifests";
import {
  isOfflineManifestExpired,
  latestOfflineArrival,
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineManifestEnvelope,
  offlineArrivalEvents,
  offlineCounterIsOver,
  offlineManifestFreshness,
  pendingOfflineEventCount,
  refusedOfflineArrival,
  rejectedOfflineEventCount,
} from "@/lib/offline-manifests";
import { offlinePreviousGaps } from "./checkpoint-gap-inputs";
import { deviceLocale } from "./shared";

/** The live manifest this saved copy stands in for, at the checkpoint on screen. */
export function liveManifestHref(
  envelope: OfflineManifestEnvelope,
  tripId: string,
  checkpoint: RollCallCheckpoint,
): string {
  return `/shop/${envelope.snapshot.shop.slug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`;
}

/**
 * **What the saved copy says at this checkpoint** — every count, seat and
 * crew reading the offline manifest draws, derived from the decrypted copy
 * and the checkpoint on screen and nothing else. Pure, so the sections read
 * one answer and the counts cannot disagree between them. Null when the copy
 * carries no manifest at all.
 */
export function offlineTripView(envelope: OfflineManifestEnvelope, checkpoint: RollCallCheckpoint) {
  const manifest =
    envelope.snapshot.manifests.find((entry) => entry.checkpoint === checkpoint) ??
    envelope.snapshot.manifests[0];
  if (!manifest) return null;
  // **The counter reads the departure's roster, whatever checkpoint the page
  // is showing.** Checking in happens once, at the desk, before the boat
  // leaves — the same reason the pre-departure checklist sits above the
  // checkpoint switcher rather than inside it.
  const counterManifest =
    envelope.snapshot.manifests.find((entry) => entry.checkpoint === "departure") ?? manifest;
  /**
   * **The counter's seats, in the order a staffer works them**, and empty once
   * the boat has gone.
   *
   * What the counter is finished with sinks to the bottom, which is the
   * live desk's composition (the Divers tab's Checked in group) and the same
   * shared predicates
   * (`isSettledAtCounter` and `counterIsDone`, `src/lib/check-in.ts`) —
   * "settled" is checked in *and still cleared*, so a diver who came through
   * the door and has gone blocked since stays up in the working list wearing
   * their reasons, while a seat the desk released sinks because there is no tap
   * left to make on it. On a twenty-four-diver morning the flat roster put
   * eighteen receipts on top of the eight rows anybody could act on, and pushed
   * the roll call two screens down.
   *
   * The live page folds its settled group behind a disclosure; this one only
   * orders and dims it. A `<details>` is a second control on a wet-hands
   * surface, and the ordering is what the length problem actually needed.
   */
  const counterOver = offlineCounterIsOver(counterManifest);
  const counterSeats = counterOver
    ? []
    : counterManifest.divers
        .map((diver) => {
          const arrival = latestOfflineArrival(
            envelope.snapshot,
            diver.bookingId,
            offlineArrivalEvents(envelope),
          );
          /**
           * **The seat as the shared predicates read it**, and the one place
           * this page decides what the booking's own `status` column said when
           * the copy was taken. It answered `arrival ? "checked_in" :
           * "booked"` and nothing else, so a seat the desk had released
           * reached `isSettledAtCounter` as an ordinary booking (#1705).
           *
           * The desk's own answer wins over this device's: a released seat
           * with a queued arrival on it is a tap the server has already
           * refused, or is about to, and rendering it as checked in would be
           * this page arguing with the only authority there is.
           */
          const seat = {
            bookingStatus: diver.notHere ? "no_show" : arrival ? "checked_in" : "booked",
            readiness: diver.readiness,
          };
          return {
            diver,
            arrival,
            refused: refusedOfflineArrival(diver.bookingId, offlineArrivalEvents(envelope)),
            settled: isSettledAtCounter(seat),
            done: counterIsDone(seat),
          };
        })
        // Stable: `sort` keeps roster order inside each group, so a name does
        // not move except across the one boundary that means something.
        //
        // `counterIsDone` rather than `settled`, which is the live queue's own
        // split: a released seat is not settled — nobody is boarding on it —
        // but the counter is as finished with it as with a receipt, and a name
        // needing no tap sitting at the top of the working list is the noise
        // this ordering exists to take away.
        .sort((a, b) => Number(a.done) - Number(b.done));
  // Readiness gates boarding at departure only. After a dive, roll call is a
  // head count — a diver aboard is recorded present whatever the saved paperwork
  // said. The server re-checks the same way, so an offline board still syncs.
  const isDeparture = checkpoint === "departure";
  // Kept readable past its retention window only so an unsynced event isn't
  // silently lost (see loadOfflineManifest) — the H-05 stop rule still treats
  // it as not a boarding source, so no new roll call can be recorded here.
  const expired = isOfflineManifestExpired(envelope.snapshot);
  const freshness = offlineManifestFreshness(new Date(envelope.snapshot.savedAt));
  const pending = pendingOfflineEventCount(envelope);
  const rejected = rejectedOfflineEventCount(envelope);
  const localStates = manifest.divers.map((diver) =>
    latestOfflineRollCall(envelope.snapshot, envelope.events, diver.bookingId, checkpoint),
  );
  // The live roll call's after-dive rule, read through the same predicate
  // (`blockedAtRail`, issue #2286): a blocked diver nobody boarded at an
  // earlier checkpoint still wears their readiness here. Read off this device's
  // own taps as well as the saved copy, so a diver boarded at the dock with no
  // signal is not marked at the next count.
  const earlierCheckpoints = envelope.snapshot.manifests
    .map((entry) => entry.checkpoint)
    .filter((entry) => rollCallCheckpointOrdinal(entry) < rollCallCheckpointOrdinal(checkpoint));
  const boardedEarlier = manifest.divers.map((diver) =>
    boardedBefore(
      earlierCheckpoints.map((earlier) =>
        latestOfflineRollCall(envelope.snapshot, envelope.events, diver.bookingId, earlier),
      ),
    ),
  );
  const blockedAtRail = manifest.divers.map((diver, index) =>
    rowBlockedAtRail({
      ready: diver.readiness.status === "ready",
      isDeparture: checkpoint === "departure",
      boardedEarlier: boardedEarlier[index],
      notBackAboard: isNotBackAboard(checkpoint, localStates[index]),
    }),
  );
  // **A medical block stays on the row between dives** (issue #2380): the live
  // roll call's predicate, read off the same earlier boardings, so a diver
  // boarded over a physician's "no" keeps a medical capsule after a dive on
  // this copy too.
  const medicalHold = manifest.divers.map((diver, index) =>
    medicalHoldAfterDive({
      checkpoint,
      boardedEarlier: boardedEarlier[index],
      notBackAboard: isNotBackAboard(checkpoint, localStates[index]),
      blockerCodes: diver.readiness.blockers.map((blocker) => blocker.code),
    }),
  );
  // A seat the desk turned away is off the boat until somebody at the rail
  // records a result for it: the live manifest's own predicate, read off this
  // device's taps (`isTurnedAwayOffBoat`, issue #2907). **Only while this copy
  // is current**: the desk can put the diver back on the list after the save,
  // and a phone with no signal never hears it, so an aging or stale copy
  // counts her as awaiting again. One tap too many, never "all aboard" with
  // her uncounted (independent domain review of #2907).
  const turnAwayStands = freshness === "current";
  const offBoat = manifest.divers.map(
    (diver, index) =>
      turnAwayStands &&
      isTurnedAwayOffBoat({ turnedAway: diver.turnedAway, rollCall: localStates[index] }),
  );
  const countedDivers = offBoat.filter((off) => !off).length;
  const boarded = localStates.filter((state) => state?.state === "boarded").length;
  const awaiting = localStates.filter((state, index) => !state && !offBoat[index]).length;
  // The dock copy splits `not_boarded` exactly the way the live manifest does
  // (`isNotBackAboard`, src/lib/manifests.ts): at departure it means the diver
  // never left, after a dive it means they have not come back. Offline and
  // online disagreeing about whether everyone is out of the water is worse than
  // either being wrong on its own, so both read the same predicate (DOM-H3).
  const notBackAboard = localStates.filter((state) => isNotBackAboard(checkpoint, state)).length;
  // Both halves now come from this device's own events, read through the two
  // sibling functions in `offline-manifests.ts`: a crew member's result is
  // local-first with the snapshot's saved result behind it, exactly as a
  // diver's is. Before H-46 the crew half could only ever be the save-time
  // answer, because there was no id on this copy to write an event against —
  // which is still the case for a copy saved before that change, and is why
  // this falls back to `member.rollCall` rather than assuming an id.
  //
  // Absence is "nobody has said", never "accounted for", on both routes. A
  // checkpoint with every diver counted and a crew member uncalled reads *open*
  // here exactly as it does online; never "complete" offline and "not complete"
  // online, which is the one direction that matters — a head count that looks
  // finished while somebody is still in the water.
  const crewAssigned = manifest.crew.length;
  const crewWithState = manifest.crew.map((member) => {
    const saved = member.rollCall;
    const state = member.id
      ? latestOfflineCrewRollCall(envelope.snapshot, envelope.events, member.id, checkpoint)
      : saved
        ? {
            state: saved.state,
            occurredAt: saved.occurredAt,
            pending: false,
            implied: saved.implied ?? false,
            // Straight off the snapshot — nobody recorded this here, so there
            // is nothing on this copy to retract (see `OfflineRollCallResult.local`).
            // A crew member with no id has no subject to write an event
            // against anyway, which is why this branch exists at all.
            local: false,
          }
        : undefined;
    return { ...member, state };
  });
  // The live count uses this same certificate predicate. Count every passenger
  // kind and only crew actually aboard, including changes queued on this device.
  const overTotalPersons = personsAboveTotalPersonsAboard(
    boarded + crewWithState.filter((member) => member.state?.state === "boarded").length,
    manifest.trip.certifiedTotalPersons,
  );
  const completeness = rollCallCompleteness({
    checkpoint,
    totalDivers: countedDivers,
    awaiting,
    notBackAboard,
    crew: crewWithState.map((member) => ({ rollCall: member.state })),
  });
  const crewCounts = completeness.crewCounts;
  // `id` is the list key now that the dock copy carries one (H-46) — the same
  // stable identity the live manifest uses, and what keeps two crew who share
  // a name *and* a role apart (review 20260803, D6). A copy saved before that
  // change has no ids, so the old namesake-disambiguating key stays behind it:
  // those rows still have to render.
  const crewSeen = new Map<string, number>();
  const crewWithKeys = crewWithState.map((member) => {
    const base = `${member.fullName}\u0000${member.roles.join(",")}`;
    const nth = crewSeen.get(base) ?? 0;
    crewSeen.set(base, nth + 1);
    return { ...member, key: member.id ?? `${base}\u0000${nth}` };
  });
  // Two different facts, and a crew reading warning-yellow on every single dive
  // stops reading it at all (review 20260803, D6):
  //
  // - somebody **is unaccounted for**: a named crew member was recorded not back
  //   aboard. That is an emergency and reads as danger, wherever the divers are.
  // - part of the crew half **cannot be recorded on this copy**: a snapshot
  //   saved before crew ids rode along (H-46) carries crew with no subject to
  //   write an event against, so those people stay uncountable until this
  //   device sees a newer copy. It is fail-closed — the checkpoint does *not*
  //   read complete — and it is stated as a limitation of this saved copy, not
  //   as an alarm. On a current copy it is not stated at all, because there is
  //   no longer anything to apologise for.
  const crewMissing = completeness.crewReason === "crew_not_back_aboard";
  const crewWithoutId = crewWithKeys.filter((member) => !member.id).length;
  const rollCallComplete = completeness.complete;
  // The people this device counts (every row but a turned-away seat nobody
  // has answered for), not the (possibly stale, save-time)
  // `manifest.summary.totalDivers`. Feeds MilestoneHaptics and the
  // roll-call-complete celebration below.
  const totalDivers = countedDivers;
  // Dive-domain-expert review (task 72, invariant 4): "not boarded" carries
  // forward at later checkpoints and never resets to awaiting, so
  // `rollCallComplete` (awaiting === 0) goes true for a checkpoint with
  // carried-forward not-boarded divers on it — that's correct for the
  // heading text above ("Roll call complete" is accurate either way), but an
  // "everyone's aboard" celebration must not fire on that basis. Gate it on
  // the true boarded count instead.
  const allBoarded = totalDivers > 0 && boarded === totalDivers;
  const missingDivers = manifest.divers.filter(
    (_diver, index) => !localStates[index] && !offBoat[index],
  );
  // Whether anyone on this saved copy carries a team — gates the one line that
  // says the split-team read belongs to the live roll call. Crew count too:
  // a boat where only the divemaster's groups were recorded still needs the
  // limitation stated.
  const anyBuddies =
    manifest.divers.some((diver) => (diver.buddyTeamNames ?? []).length > 0) ||
    manifest.crew.some((member) => (member.buddyTeamNames ?? []).length > 0);
  // **What opening each checkpoint should warn about**: the gap at the
  // after-dive count before it (`previousCheckpointGaps`), read off this
  // device's own taps. A warning only; every checkpoint stays one tap away.
  const previousGaps = offlinePreviousGaps(envelope);
  const dateTime = cachedFormatter("dt", Intl.DateTimeFormat, deviceLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: envelope.snapshot.shop.timezone,
  });
  // The save time the roll call's caveat names (issue #2980): with its zone,
  // since a phone set to another zone would otherwise read the age wrong.
  const savedAtZoned = keepUnitsWhole(
    cachedFormatter("dtz", Intl.DateTimeFormat, deviceLocale(), {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: envelope.snapshot.shop.timezone,
    }).formatToParts(new Date(envelope.snapshot.savedAt)),
  );
  return {
    envelope,
    checkpoint,
    manifest,
    counterManifest,
    counterOver,
    counterSeats,
    isDeparture,
    expired,
    freshness,
    pending,
    rejected,
    localStates,
    offBoat,
    blockedAtRail,
    medicalHold,
    boarded,
    overTotalPersons,
    awaiting,
    notBackAboard,
    crewAssigned,
    crewWithState,
    completeness,
    crewCounts,
    crewSeen,
    crewWithKeys,
    crewMissing,
    crewWithoutId,
    rollCallComplete,
    totalDivers,
    allBoarded,
    missingDivers,
    anyBuddies,
    previousGaps,
    dateTime,
    savedAtZoned,
  };
}

export type OfflineTripView = NonNullable<ReturnType<typeof offlineTripView>>;
