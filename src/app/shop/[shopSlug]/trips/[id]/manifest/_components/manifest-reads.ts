import { departureKitRecord } from "@/db/boat-safety";
import { departureVessels } from "@/db/boats";
import { listTripBuddyTeams, planPartyTeams } from "@/db/buddy-pairs";
import type { AppDb } from "@/db/client";
import { listDeskEventsSince } from "@/db/desk-events";
import { diveIntentTallyForTrip } from "@/db/dive-intent";
import { listDiveSites, listSiteFieldGuides } from "@/db/dive-sites";
import { listExecutedDives } from "@/db/executed-dives";
import { getTripManifests } from "@/db/manifests";
import { listBookingNotes, listDiverNotesForTrip } from "@/db/operations";
import { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import { listShopPickedSpecies, listTripSightings } from "@/db/trip-sightings";
import { latestTripStage } from "@/db/trip-stages";
import { getTripMeetingPointFields, listTripDives } from "@/db/trips";

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
    vessels,
    kitRecord,
    partyPlan,
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
    // The departure's own boat, for the emergency card and the printed head
    // (fourth review, item 11).
    departureVessels(db, shopId, [tripId]),
    // The oxygen and first aid kit the register holds aboard that boat, for
    // the printed kit lines (fourth review, item 17).
    departureKitRecord(db, shopId, tripId),
    // Who booked together, and which parties one tap may team (item 50).
    planPartyTeams(db, shopId, tripId),
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
    stage,
    meetingPoint,
    vessel: vessels.get(tripId) ?? null,
    kitRecord,
    partyPlan,
    fieldGuides,
    loggedSightings,
    shopPickedSpecies,
  };
}
