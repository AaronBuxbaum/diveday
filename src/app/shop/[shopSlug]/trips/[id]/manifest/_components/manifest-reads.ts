import { listTripBuddyTeams } from "@/db/buddy-pairs";
import type { AppDb } from "@/db/client";
import { listDeskEventsSince } from "@/db/desk-events";
import { diveIntentTallyForTrip } from "@/db/dive-intent";
import { listDiveSites, listSiteFieldGuides } from "@/db/dive-sites";
import { listExecutedDives } from "@/db/executed-dives";
import { getTripManifests, rollCallOpenOnTrip } from "@/db/manifests";
import { listBookingNotes, listDiverNotesForTrip } from "@/db/operations";
import { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import { meetingWindowsByTrip } from "@/db/trip-meeting-windows";
import { listShopPickedSpecies, listTripSightings } from "@/db/trip-sightings";
import { latestTripStage } from "@/db/trip-stages";
import { getTripMeetingPointFields, listTripDives } from "@/db/trips";
import { cancelledRollCall } from "@/lib/roll-call";

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
  /** The staffer reading: the catch-up strip is "since *you* last looked". */
  personId: string,
) {
  // The manifest rows, the raw team membership, and the desk's own notes don't
  // depend on one another — resolve them together instead of serially.
  const [
    completeManifests,
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
    rollCallOpen,
  ] = await Promise.all([
    getTripManifests(db, shopId, tripId),
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
    // The roll-call writers' own gate (#2285): a cancelled departure nobody
    // counted on draws no control that could only be refused.
    rollCallOpenOnTrip(db, shopId, tripId),
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
  const [loggedSightings, shopPickedSpecies] = await Promise.all([
    listTripSightings(db, shopId, tripId),
    listShopPickedSpecies(db, shopId),
  ]);
  // A multi-day run's real windows, for the stage strip's tap (issue #2406).
  const dockTrip = completeManifests?.[0]?.trip;
  const meetingWindows = dockTrip
    ? (await meetingWindowsByTrip(db, [dockTrip])).get(tripId)
    : undefined;
  return {
    completeManifests,
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
    // The crew's latest word and the run's windows, read together (`stageStripProps`).
    stageStrip: { stage, meetingWindows },
    meetingPoint,
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
