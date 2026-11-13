import type { PrintedMedicalAlerts } from "@/db/medical-alerts";
import type { requireShopSurface } from "@/features/session";
import { boatSafetySection } from "@/i18n/boat-safety-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { emergencyReferenceForDeparture } from "@/lib/emergency-reference";
import type { ManifestActionContext } from "../actions";
import { bindManifestActions } from "./bound-actions";
import { buddyBuilderView } from "./buddy-builder-view";
import { emergencyReferenceCopy } from "./manifest-copy";
import { readManifestPage } from "./manifest-reads";
import { openCheckpoint } from "./open-checkpoint";
import { printedBoatProcedureCopy, printedKitRegister } from "./PrintedBoatProcedure";
import { manifestPaperIdentity } from "./paper-identity";
import { personTrailIndex } from "./person-trail";
import { preDepartureCheckView } from "./pre-departure-check-view";
import { rollCallCopies } from "./roll-call-copy";
import { manifestRollCallProps } from "./roll-call-props";
import { manifestNoteThreads } from "./StaffNotes";
import { stageStripProps } from "./stage-strip-props";

type ShopSurface = Awaited<ReturnType<typeof requireShopSurface>>;

/**
 * **One departure's manifest, read once for both of its faces**: the live
 * Boat tab (`../page.tsx`) and the packet's manifest sheet
 * (`ManifestSheetSection`). Every reader, every derived view and every bound
 * action the two share is built here, so the sheet a captain carries cannot
 * drift from the screen they just reviewed.
 *
 * Answers `"missing"` for a departure that is gone or another shop's, and
 * `"stale"` for a checkpoint this plan lacks; the caller decides what each
 * means for its own document (a 404 for the route, a dropped boat on the
 * day's paper).
 */
export async function readManifestView({
  db,
  shop,
  session,
  shopSlug,
  tripId,
  requestedCheckpoint,
  buddyError,
  idPrefix,
  printedMedicalAlerts,
  locale,
  t,
}: Pick<ShopSurface, "db" | "shop" | "session"> & {
  shopSlug: string;
  tripId: string;
  requestedCheckpoint?: string;
  buddyError?: string;
  /** Set when several departures share one document (`src/lib/element-id.ts`). */
  idPrefix?: string;
  /** Only from "Print with medical alerts" (issue #2990), which recorded the print first. */
  printedMedicalAlerts?: PrintedMedicalAlerts;
  locale: string;
  t: StaffTranslator;
}) {
  const read = await readManifestPage(db, shop, tripId, session.user.personId);
  const { completeManifests, boatCheck, renderErasureEpoch } = read;
  const departureManifest = completeManifests?.[0];
  if (
    !departureManifest ||
    !completeManifests ||
    !boatCheck.offlineRoster ||
    renderErasureEpoch === null
  )
    return { status: "missing" as const };
  const offlineRoster = boatCheck.offlineRoster;
  const boatSafety = boatSafetySection(t, locale, read.boatSafety);

  const opened = openCheckpoint(completeManifests, departureManifest, requestedCheckpoint);
  if ("stale" in opened) return { status: "stale" as const };
  const { checkpoint, isDeparture, manifest } = opened;
  const todayTrailBySubject = personTrailIndex(completeManifests, locale, shop.timezone, t);

  const actionContext: ManifestActionContext = { shopSlug, tripId, checkpoint };
  const actions = bindManifestActions(actionContext, read.reader, printedMedicalAlerts);
  const checklist = preDepartureCheckView({
    ...boatCheck,
    snagActions: read.vessel ? { note: actions.noteSnag, answer: actions.answerSnag } : undefined,
    locale,
    timeZone: shop.timezone,
    t,
  });
  const buddy = buddyBuilderView({
    manifest,
    buddyTeamsList: read.buddyTeamsList,
    buddyError,
    partyPlan: read.partyPlan,
    locale,
    t,
  });
  const notesByBooking = manifestNoteThreads(read.bookingNotes, read.diverNotes);
  const emergencyCopy = emergencyReferenceCopy(t);
  // This departure's own boat on every copy of the card, the shop line only without one (item 11).
  const emergencyReference = emergencyReferenceForDeparture(shop.emergencyReference, read.vessel);
  const rollCall = manifestRollCallProps({
    idPrefix,
    manifest,
    checkpoint,
    isDeparture,
    shopSlug,
    tripId,
    locale,
    timezone: shop.timezone,
    notesByBooking,
    todayTrailBySubject,
    rollCallClosed: read.cancelled === "closed",
    actions,
    copies: rollCallCopies(t, shopSlug, tripId),
    buddyTeamLabel: buddy.buddyTeamLabel,
    t,
  });
  const boatPaper = {
    idPrefix,
    reference: emergencyReference,
    emergencyCopy,
    copy: printedBoatProcedureCopy(t),
    kitRegister: printedKitRegister(read.kitRecord, t, locale),
  };
  const checklistProps = {
    idPrefix,
    action: actions.preDepartureCheck,
    atDeparture: isDeparture,
    ...checklist,
  };
  const stage = stageStripProps(t, {
    manifests: completeManifests,
    shopSlug,
    ...read.stageStrip,
    now: nowDate(),
    timeZone: shop.timezone,
    locale,
  });
  const dockDesk = {
    t,
    shop,
    tripId,
    isDeparture,
    trip: departureManifest.trip,
    stage: read.stageStrip.stage,
    seats: manifest.divers,
  };
  const paperIdentity = manifestPaperIdentity(
    shop,
    departureManifest.trip,
    read.vessel,
    checkpoint,
    locale,
    t,
    session.user.name,
  );
  return {
    status: "ready" as const,
    ...read,
    renderErasureEpoch,
    completeManifests,
    offlineRoster,
    departureManifest,
    boatSafety,
    checkpoint,
    isDeparture,
    manifest,
    actionContext,
    actions,
    buddy,
    emergencyCopy,
    emergencyReference,
    rollCall,
    boatPaper,
    checklistProps,
    stage,
    dockDesk,
    paperIdentity,
  };
}
