import { randomUUID } from "node:crypto";
import { canPersonReadMedicalAlertOnTrip } from "@/db/authz";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import { departureBoatSafetyFor } from "@/db/boat-safety";
import type { AppDb } from "@/db/client";
import { getTripManifests } from "@/db/manifests";
import { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import type { getShopById } from "@/db/shops";
import { getShopOfflineDatasetIncarnation, getShopOfflineErasureEpoch } from "@/db/shops";
import { departureVessels } from "@/features/boats";
import { boatSafetySection } from "@/i18n/boat-safety-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { crewBlockerText } from "@/i18n/identity-check-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { departureCrewCount } from "@/lib/boat-safety";
import { nowDate } from "@/lib/clock";
import { emergencyReferenceForDeparture } from "@/lib/emergency-reference";
import { manifestPhysicalCounts } from "@/lib/manifests";
import { mapWithLimit } from "@/lib/map-limit";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import type {
  OfflineManifestPayload,
  OfflineManifestUpcomingResponse,
} from "@/lib/offline-manifests";
import { serializeManifests } from "@/lib/offline-manifests";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { rollCallDayBoundariesOf } from "@/lib/trip-days";
import { meetingDaysAtLock, nextOfflineManifestSnapshotRevision } from "./store";

/** Shared complete, fenced roster refresh for priming and causal sync receipts. */
export async function buildOfflineManifestCopies(
  db: AppDb,
  shop: NonNullable<Awaited<ReturnType<typeof getShopById>>>,
  personId: string,
  tripIds: readonly string[],
): Promise<OfflineManifestUpcomingResponse> {
  const user = { personId };
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();
  const MANIFEST_BUILD_CONCURRENCY = 3;
  const shopIdentity = {
    slug: shop.slug,
    name: shop.name,
    timezone: shop.timezone,
    // Primed with the board, because the whole point is that it is already on
    // the device when the signal goes (issue #688).
    emergencyReference: shop.emergencyReference,
  };
  const payloads = await mapWithLimit(
    tripIds,
    MANIFEST_BUILD_CONCURRENCY,
    async (tripId): Promise<OfflineManifestPayload | null> =>
      db.transaction(async (tx) => {
        // The snapshot id, shop epoch, roster, and free-text evidence are read
        // under one shared fence. Erasure either follows and sweeps everything
        // read here, or precedes it and the token carries the new epoch.
        await lockBoardingCertificationEvidence(tx, shop.id, "boarding");
        const epoch = await getShopOfflineErasureEpoch(tx, shop.id);
        if (epoch === null) return null;
        const datasetIncarnation = await getShopOfflineDatasetIncarnation(tx, shop.id);
        if (!datasetIncarnation) return null;
        const snapshotRevision = await nextOfflineManifestSnapshotRevision(tx, shop.id, tripId);
        if (snapshotRevision === null) return null;
        const snapshotId = randomUUID();
        // PGlite's database type includes its client handle while the
        // transaction executor intentionally does not. The manifest readers
        // use only Drizzle query methods, which both objects implement.
        const manifests = await getTripManifests(tx as unknown as AppDb, shop.id, tripId);
        if (!manifests) return null;
        // Read the ordered meeting identities after taking the owned-trip
        // lock: an edit cannot change this mapping while this copy is issued.
        const meetings = await meetingDaysAtLock(tx, tripId);
        const checklistItems = await listChecklistItems(tx, shop.id);
        const checks = checklistItems.length
          ? await latestPreDepartureChecksForTrip(tx, shop.id, tripId)
          : new Map();
        const vessels = await departureVessels(tx, shop.id, [tripId]);
        // The boat's papers and kit, worded as the Boat tab words them.
        const departure = manifests[0];
        const boatSafety = departure
          ? boatSafetySection(
              t,
              locale,
              await departureBoatSafetyFor(tx, shop.id, {
                tripId,
                startsAt: departure.trip.startsAt,
                timeZone: shop.timezone,
                now,
                passengers: {
                  booked: departure.summary.totalDivers,
                  boarded: departure.summary.boarded,
                },
                crew: departureCrewCount(departure.crew),
                persons: manifestPhysicalCounts(departure),
              }),
            )
          : null;
        const payload = serializeManifests(
          manifests,
          {
            ...shopIdentity,
            emergencyReference: emergencyReferenceForDeparture(
              shop.emergencyReference,
              vessels.get(tripId) ?? null,
            ),
          },
          (blocker, diver) => crewBlockerText(t, diver, blocker),
          checklistItems.map((item) => ({
            id: item.id,
            label: item.label,
            check: checks.get(item.id),
          })),
          boatSafety,
          undefined,
          (advisory) =>
            advisory.params.verificationReasons?.length
              ? t("shared.offlineManifest.juniorCheckRequired")
              : depthWarningText(t, advisory),
        );
        const boundaries = rollCallDayBoundariesOf(meetings);
        return {
          ...payload,
          ...(boundaries ? { rollCallDayBoundaries: boundaries } : {}),
          rollCallMeetingDays: meetings.map((day, meetingDay) => ({
            startsAt: day.startsAt.toISOString(),
            endsAt: day.endsAt.toISOString(),
            meetingIdentityProof: signOfflineMeetingIdentity({
              shopId: shop.id,
              tripId,
              snapshotId,
              meetingId: day.id,
              scheduleGeneration: day.scheduleGeneration,
              datasetIncarnation,
              startsAt: day.startsAt,
              endsAt: day.endsAt,
              meetingDay,
            }),
          })),
          snapshotId,
          erasureEpochToken: signOfflineErasureEpoch({
            shopId: shop.id,
            tripId,
            snapshotId,
            epoch,
            snapshotRevision,
          }),
        };
      }),
  );

  const served = payloads.filter((payload): payload is OfflineManifestPayload => payload !== null);
  // Read live per departure, so a refresh drops words this viewer saved and
  // may no longer hold (security review 2, L3).
  const mayHoldMedicalAlertWords: Record<string, boolean> = {};
  for (const payload of served) {
    const tripId = payload.manifests[0]?.trip.id;
    if (!tripId) continue;
    mayHoldMedicalAlertWords[tripId] = await canPersonReadMedicalAlertOnTrip(
      db,
      shop.id,
      user.personId,
      tripId,
    );
  }

  const body: OfflineManifestUpcomingResponse = {
    // Always returned, even with zero trips in the window: a caller that is
    // already paying for the roster gets the server-verified "who am I signed
    // in as" signal in the same response rather than a second request, and uses
    // it to purge any other shop's leftover device records — see ADR
    // 20260726-shopwide-offline-manifest-priming's cross-tenant-device
    // addendum. A payload can never carry a shop.slug the caller doesn't own
    // (serializeManifests only ever receives this same session-derived shop).
    // A caller that wants *only* this asks `/api/offline-manifests/identity`,
    // which is the same string without the board attached.
    shop: shopIdentity,
    payloads: served,
    // Who asked, so the device wipes medical alert words someone else saved
    // (H-20261023-medical-alert-for-the amendment). The board itself never carries those words.
    viewer: { personId: user.personId },
    mayHoldMedicalAlertWords,
  };
  return body;
}
