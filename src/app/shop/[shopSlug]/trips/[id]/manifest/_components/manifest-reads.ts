import { canPersonReadMedicalAlertOnTrip, emergencyMedicalAlertStanding } from "@/db/authz";
import { departureBoatSafetyFor, departureKitRecord } from "@/db/boat-safety";
import { listTripBuddyTeams, planPartyTeams } from "@/db/buddy-teams";
import type { AppDb } from "@/db/client";
import { listDiveSiteNames, listSiteFieldGuides } from "@/db/dive-sites";
import { listExecutedDives } from "@/db/executed-dives";
import { mayStartTripIncidentReport, openMissingAlerts } from "@/db/incident-reports";
import { rollCallOpenOnTrip } from "@/db/manifests";
import { listBookingNotes, listDiverNotesForTrip } from "@/db/operations";
import { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import { meetingWindowsByTrip } from "@/db/trip-meeting-windows";
import { listCatchUpSince } from "@/db/trip-read-marks";
import { getTripMeetingPointFields, listTripDives } from "@/db/trips";
import { openSnagsForTrip } from "@/features/boat-snags";
import { departureVessels } from "@/features/boats";
import { diveIntentTallyForTrip } from "@/features/dive-intent";
import { readOfflineManifestRoster } from "@/features/offline-manifest-snapshots";
import type { SiteHistory } from "@/features/site-history";
import { lastAtSites } from "@/features/site-history";
import { listShopPickedSpecies, listTripSightings } from "@/features/trip-sightings";
import { latestTripStage } from "@/features/trip-stages";
import { departureCrewCount } from "@/lib/boat-safety";
import { nowDate } from "@/lib/clock";
import { manifestPhysicalCounts } from "@/lib/manifests";
import { cancelledRollCall } from "@/lib/roll-call";

/**
 * **Everything the boat manifest reads, in the waves the page awaits them**:
 * the roster establishes the erasure epoch first, then independent reads start
 * together, including the boat safety read beside the roster-dependent reads.
 * Nothing here depends on which checkpoint is open, so the page settles that
 * after the reads resolve.
 */
export async function readManifestPage(
  db: AppDb,
  shop: { id: string; timezone: string },
  tripId: string,
  /** The staffer reading: the catch-up strip is "since *you* last looked", and who may report. */
  personId: string,
) {
  // Start buddy membership and notes only after the roster's erasure epoch is
  // known, so the render proof cannot certify identity reads from before it.
  // The manifests and the erasure epoch they were read at, on the pool and
  // writing nothing (issue #4391). The page shows these rows and the device
  // saves these same rows, so the screen and the copy cannot differ; the
  // save trades the epoch for a signed token, refused if an erasure landed
  // since (`issueOfflineManifestSnapshot`, `/api/offline-manifests/[tripId]/snapshot`).
  const shopId = shop.id;
  // All the other identity-bearing reads start after the roster has captured
  // its epoch. A later roster epoch cannot certify earlier buddy or note reads.
  const rosterResult = await readOfflineManifestRoster(db, shopId, tripId);
  const renderErasureEpoch = rosterResult?.erasureEpoch ?? null;
  const roster = Promise.resolve(rosterResult);
  const sites = listDiveSiteNames(db, shopId);
  const dives = listTripDives(db, shopId, tripId);
  const vesselRows = departureVessels(db, shopId, [tripId]);
  const guides = sites.then((rows) =>
    listSiteFieldGuides(
      db,
      shopId,
      rows.map((site) => site.id),
    ),
  );
  const windows = roster.then(async (rows) => {
    const trip = rows?.manifests[0]?.trip;
    return trip ? (await meetingWindowsByTrip(db, [trip])).get(tripId) : undefined;
  });
  const history = Promise.all([roster, dives]).then(([rows, planned]) => {
    const startsAt = rows?.manifests[0]?.trip.startsAt;
    return startsAt
      ? lastAtSites(db, {
          shopId,
          siteIds: planned.flatMap(({ diveSite }) => (diveSite ? [diveSite.id] : [])),
          before: startsAt,
          excludeTripId: tripId,
        })
      : new Map<string, SiteHistory>();
  });
  const safety = Promise.all([roster, vesselRows]).then(([rows, vessels]) => {
    const departure = rows?.manifests[0];
    return departure
      ? departureBoatSafetyFor(db, shopId, {
          tripId,
          boatId: vessels.get(tripId)?.boatId ?? null,
          startsAt: departure.trip.startsAt,
          timeZone: shop.timezone,
          now: nowDate(),
          passengers: { booked: departure.summary.totalDivers, boarded: departure.summary.boarded },
          persons: manifestPhysicalCounts(departure),
          crew: departureCrewCount(departure.crew),
        })
      : null;
  });
  const [
    offlineRoster,
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
    fieldGuides,
    loggedSightings,
    shopPickedSpecies,
    siteHistory,
    meetingWindows,
    boatSafety,
  ] = await Promise.all([
    roster,
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
    // After the roster, never beside it: the saved copy carries these ticks
    // under the roster's snapshot revision, and a device reads its own synced
    // tick as in the copy by that revision (`offlineEventInCopy`). Read before
    // the revision, a tick could be older than the copy claims.
    roster.then(() => latestPreDepartureChecksForTrip(db, shopId, tripId)),
    dives,
    listExecutedDives(db, shopId, tripId),
    sites,
    // What the desk did since *this* staffer last looked (issues #1202,
    // #1187). Empty for somebody who has never worked this departure — there is
    // nothing for a catch-up to be "since", and replaying the morning to a
    // first-time reader is the surveillance feed the boundary refuses.
    listCatchUpSince(db, shopId, tripId, personId),
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
    vesselRows,
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
    guides,
    listTripSightings(db, shopId, tripId),
    listShopPickedSpecies(db, shopId),
    history,
    windows,
    safety,
  ]);
  const completeManifests = offlineRoster?.manifests ?? null;
  const dockTrip = completeManifests?.[0]?.trip;
  return {
    renderErasureEpoch,
    completeManifests,
    boatSafety,
    offlineRoster,
    buddyTeamsList,
    bookingNotes,
    diverNotes,
    // The boat check, and what earlier crews on this boat said is wrong with it.
    boatCheck: { checklistItems, checklistChecks, snags, offlineRoster },
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
