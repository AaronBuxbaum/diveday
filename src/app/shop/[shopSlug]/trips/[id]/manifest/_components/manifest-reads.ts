import { canPersonReadMedicalAlertOnTrip, emergencyMedicalAlertStanding } from "@/db/authz";
import { departureKitRecord } from "@/db/boat-safety";
import { openSnagsForTrip } from "@/db/boat-snags";
import { departureVessels } from "@/db/boats";
import { listTripBuddyTeams, planPartyTeams } from "@/db/buddy-pairs";
import type { AppDb } from "@/db/client";
import { listDeskEventsSince } from "@/db/desk-events";
import { diveIntentTallyForTrip } from "@/db/dive-intent";
import { listDiveSites, listSiteFieldGuides } from "@/db/dive-sites";
import { listExecutedDives } from "@/db/executed-dives";
import { mayStartTripIncidentReport, openMissingAlerts } from "@/db/incident-reports";
import { getTripManifests, rollCallOpenOnTrip } from "@/db/manifests";
import { issueOfflineManifestSnapshot } from "@/db/offline-manifest-snapshots";
import { listBookingNotes, listDiverNotesForTrip } from "@/db/operations";
import { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import { lastAtSites } from "@/db/site-history";
import { meetingWindowsByTrip } from "@/db/trip-meeting-windows";
import { listShopPickedSpecies, listTripSightings } from "@/db/trip-sightings";
import { latestTripStage } from "@/db/trip-stages";
import { getTripMeetingPointFields, listTripDives } from "@/db/trips";
import { cancelledRollCall } from "@/lib/roll-call";
import type { SiteHistory } from "@/lib/site-history";

/**
 * **Everything the boat manifest reads, in the waves the page awaits them**:
 * one `Promise.all` of the departure's own rows, then the field guides keyed
 * by the sites that wave returned, then the two sighting reads beside them.
 * Nothing here depends on which checkpoint is open, so the page settles that
 * after the reads resolve.
 */
export async function readManifestPage(
  db: AppDb,
  shopId: string,
  tripId: string,
  /** The staffer reading: the catch-up strip is "since *you* last looked", and who may report. */
  personId: string,
) {
  // The manifest rows, the raw team membership, and the desk's own notes don't
  // depend on one another — resolve them together instead of serially.
  const [
    completeManifests,
    offlineSnapshot,
    buddyTeamsList,
    bookingNotes,
    diverNotes,
    checklistItems,
    checklistChecks,
    plannedDives,
    executedDives,
    liveDiveSites,
    catchUp,
    diveIntents,
    stage,
    meetingPoint,
    mayStartIncidentReport,
    vessels,
    kitRecord,
    snags,
    partyPlan,
    rollCallOpen,
    missingAlerts,
    mayReadMedicalAlerts,
    emergencyStanding,
  ] = await Promise.all([
    getTripManifests(db, shopId, tripId),
    issueOfflineManifestSnapshot(db, shopId, tripId),
    // Raw membership rows, cancelled members included: the teams panel must show
    // a team whose seat was cancelled (it still blocks re-teaming the survivors
    // until dissolved), while the manifest derivation already dropped that
    // member from every row's team (ADR 20260804-buddy-teams).
    listTripBuddyTeams(db, shopId, tripId),
    // The private staff notes written on the Trip surface. Read here, never
    // written here — see `StaffNotes`.
    listBookingNotes(db, shopId, tripId),
    // Person-scoped notes written on the Diver record. Resolve them onto this
    // trip's booking below so every interface reads the same source of truth.
    listDiverNotesForTrip(db, shopId, tripId),
    listChecklistItems(db, shopId),
    latestPreDepartureChecksForTrip(db, shopId, tripId),
    listTripDives(db, shopId, tripId),
    listExecutedDives(db, shopId, tripId),
    listDiveSites(db, shopId),
    // What the desk did since *this* staffer last looked (issues #1202,
    // #1187). Empty for somebody who has never worked this departure — there is
    // nothing for a catch-up to be "since", and replaying the morning to a
    // first-time reader is the surveillance feed the boundary refuses.
    listDeskEventsSince(db, shopId, tripId, personId),
    // Codes and counts, never a row per seat (#1183's boundary).
    diveIntentTallyForTrip(db, shopId, tripId),
    // The newest word the crew tapped; `stageStripProps` reads it by the rule
    // Today's card and the departure header print, so the strip still speaks
    // on a boat that is hours overdue.
    latestTripStage(db, shopId, tripId),
    // Where the boat meets, so the plan says what the diver's `/ready` says
    // (UX review 2026-10-13, item 18).
    getTripMeetingPointFields(db, shopId, tripId),
    // Who may start an incident report here: a row marked not back aboard
    // offers the missing diver report to them alone (safety sheet item 2).
    mayStartTripIncidentReport(db, shopId, tripId, personId),
    // The departure's own boat, for the emergency card and the printed head
    // (fourth review, item 11).
    departureVessels(db, shopId, [tripId]),
    // The oxygen and first aid kit the register holds aboard that boat, for
    // the printed kit lines (fourth review, item 17).
    departureKitRecord(db, shopId, tripId),
    // What earlier crews on this boat said is wrong with it, and what this
    // crew wrote (fifth-loop ideas, item 1).
    openSnagsForTrip(db, shopId, tripId),
    // Who booked together, and which parties one tap may team (item 50).
    planPartyTeams(db, shopId, tripId),
    // The roll-call writers' own gate (#2285): a cancelled departure nobody
    // counted on draws no control that could only be refused.
    rollCallOpenOnTrip(db, shopId, tripId),
    // Who the owners were alerted about and are not found yet: their rows offer Found.
    openMissingAlerts(db, shopId, tripId),
    // Whether this reader may open a medical alert's words here (issue
    // #2960): the owner, a manager, or crew a manager put on this departure.
    canPersonReadMedicalAlertOnTrip(db, shopId, personId, tripId),
    // Where they stand for opening one in an emergency instead (issue #2990):
    // any active staffer, on the days of the trip in the shop's zone.
    emergencyMedicalAlertStanding(db, shopId, personId, tripId),
  ]);
  // Each live site's field guide, for the dive log's "one thing you saw"
  // picker (issue #1190). Read after the sites resolve because it is keyed by
  // their ids, and the species a crew may claim to have seen are exactly the
  // ones the shop has said that reef shows.
  const fieldGuides = await listSiteFieldGuides(
    db,
    shopId,
    liveDiveSites.map((site) => site.id),
  );
  // The crew's own tally for this departure, and every species the shop has
  // picked anywhere — the two rungs under a site's own field guide in
  // `seenChipSlugs`. Both are shop-wide reads with no dependency on which
  // checkpoint is open, so they resolve together beside the guides.
  // What each planned site was like the last time a boat went (fifth-loop
  // ideas, item 6), keyed by the plan's own site ids and this departure's start.
  const departureStartsAt = completeManifests?.[0]?.trip.startsAt;
  const [loggedSightings, shopPickedSpecies, siteHistory] = await Promise.all([
    listTripSightings(db, shopId, tripId),
    listShopPickedSpecies(db, shopId),
    departureStartsAt
      ? lastAtSites(db, {
          shopId,
          siteIds: plannedDives.flatMap(({ diveSite }) => (diveSite ? [diveSite.id] : [])),
          before: departureStartsAt,
          excludeTripId: tripId,
        })
      : new Map<string, SiteHistory>(),
  ]);
  // A multi-day run's real windows, for the stage strip's tap (issue #2406).
  const dockTrip = completeManifests?.[0]?.trip;
  const meetingWindows = dockTrip
    ? (await meetingWindowsByTrip(db, [dockTrip])).get(tripId)
    : undefined;
  return {
    completeManifests,
    offlineSnapshot,
    buddyTeamsList,
    bookingNotes,
    diverNotes,
    // The boat check, and what earlier crews on this boat said is wrong with it.
    boatCheck: { checklistItems, checklistChecks, snags, offlineSnapshot },
    plannedDives,
    executedDives,
    liveDiveSites,
    catchUp,
    diveIntents,
    // The crew's latest word and the run's windows, read together (`stageStripProps`).
    stageStrip: { stage, meetingWindows },
    meetingPoint,
    // What this reader may do here: start a report, and whose owners were
    // alerted (issue #2694); whether they may read the medical alerts (issue
    // #2960). Never the words: they leave the server only through a recorded
    // tap or an explicit offline save (H-20261023-medical-alert-for-the).
    reader: {
      mayStartIncidentReport,
      alerted: new Set(
        missingAlerts.flatMap((row) => [row.bookingId, row.personId]).filter((id) => id !== null),
      ),
      mayReadMedicalAlerts,
      // Offered only where the crew rule refused (`bindManifestActions`), and
      // while the trip's days have not ended, the day before included: a tab
      // opened the night before still has it at sea (domain review 2, S1).
      // The server decides on the confirm.
      mayEmergencyReadMedicalAlerts:
        !mayReadMedicalAlerts && (emergencyStanding === "open" || emergencyStanding === "not_yet"),
      // Offer "Save the medical alerts for offline" (H-20261023-medical-alert-for-the amendment) only to
      // a reader allowed the words, on a departure where a seat has an alert.
      mayCarryMedicalAlertsOffline:
        mayReadMedicalAlerts &&
        (completeManifests?.[0]?.divers.some(
          (diver) => diver.medicalAlert && !diver.identityWithheld,
        ) ??
          false),
    },
    vessel: vessels.get(tripId) ?? null,
    kitRecord,
    siteHistory,
    partyPlan,
    // A cancelled departure (#2285): closed when nobody was counted before the
    // cancel, so no row draws a control the writer would refuse; still counting
    // when the count had begun, which keeps every control (dive-domain review,
    // 2026-10-09). Null when the departure is not cancelled.
    cancelled: cancelledRollCall({ cancelled: dockTrip?.cancelled === true, rollCallOpen }),
    fieldGuides,
    loggedSightings,
    shopPickedSpecies,
  };
}
