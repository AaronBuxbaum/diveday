import { randomUUID } from "node:crypto";
import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "@/app/api/offline-manifests/staff-context";
import { canPersonReadMedicalAlertOnTrip } from "@/db/authz";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import { departureBoatSafetyFor } from "@/db/boat-safety";
import { departureVessels } from "@/db/boats";
import type { AppDb } from "@/db/client";
import { getTripManifests } from "@/db/manifests";
import { nextOfflineManifestSnapshotRevision } from "@/db/offline-manifest-snapshots";
import { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import { getShopOfflineErasureEpoch } from "@/db/shops";
import { listTripIdsInOfflineManifestWindow } from "@/db/trips";
import { boatSafetySection } from "@/i18n/boat-safety-labels";
import { crewBlockerText } from "@/i18n/identity-check-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { departureCrewCount } from "@/lib/boat-safety";
import { nowDate } from "@/lib/clock";
import { emergencyReferenceForDeparture } from "@/lib/emergency-reference";
import { withE2EApiTiming } from "@/lib/observability/query-timing";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import type {
  OfflineManifestPayload,
  OfflineManifestUpcomingResponse,
} from "@/lib/offline-manifests";
import { serializeManifests } from "@/lib/offline-manifests";

// See ADR 20260726-shopwide-offline-manifest-priming: 48 hours covers "today
// and tomorrow" in any shop timezone without depending on a staffer having
// opened that specific trip's live manifest first, while staying well short
// of caching a shop's entire future board on every device that visits it.
const AUTO_SAVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * This body is a shop's whole 48-hour board — diver names, emergency contacts,
 * readiness blockers — and it must never sit in any cache but the encrypted
 * IndexedDB store it is fetched to fill. `private` keeps it out of a shared
 * proxy; `no-store` keeps it out of the browser's own disk cache and out of a
 * back/forward replay on the shared boat tablet this whole feature runs on
 * (review 20260802, action item 12).
 */
/**
 * Every scheduled trip in the rolling window — including one already
 * underway, not only ones yet to depart, so a trip mid-charter still gets
 * its after-dive-checkpoint copy auto-saved — serialized the same way a
 * single trip's live manifest page is, so the client can feed each one
 * straight into the existing saveOfflineManifest path unchanged.
 * Staff-session-gated and scoped to the caller's own shop, the same way the
 * per-trip manifest page and its SSE stream are — and gated on the caller's
 * *live* roles, byte-identically to `/api/offline-manifests/identity`. This is
 * the body that made that matter: a staffer removed from the shop kept pulling
 * the whole board from any device for as long as their token lasted.
 *
 * Only for callers that genuinely want the roster: the shop layout's
 * `OfflineManifestAutoSave` and the service worker's `refreshSavedManifests`.
 * A caller that only needs to know *which shop this browser is signed in as*
 * asks `GET /api/offline-manifests/identity` instead, which answers with one
 * string and none of this.
 */
async function getUpcomingManifests() {
  const access = await authorizeOfflineManifestStaff();
  if (access.ok === false) return access.response;
  const { db, shop, user } = access;

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const now = nowDate();
  const windowEnd = new Date(now.getTime() + AUTO_SAVE_WINDOW_MS);
  const tripIds = await listTripIdsInOfflineManifestWindow(db, shop.id, now, windowEnd);

  const shopIdentity = {
    slug: shop.slug,
    name: shop.name,
    timezone: shop.timezone,
    // Primed with the board, because the whole point is that it is already on
    // the device when the signal goes (issue #688).
    emergencyReference: shop.emergencyReference,
  };
  const payloads = await Promise.all(
    tripIds.map(
      async (tripId): Promise<OfflineManifestPayload | null> =>
        db.transaction(async (tx) => {
          // The snapshot id, shop epoch, roster, and free-text evidence are read
          // under one shared fence. Erasure either follows and sweeps everything
          // read here, or precedes it and the token carries the new epoch.
          await lockBoardingCertificationEvidence(tx, shop.id, "boarding");
          const epoch = await getShopOfflineErasureEpoch(tx, shop.id);
          if (epoch === null) return null;
          const snapshotRevision = await nextOfflineManifestSnapshotRevision(tx, shop.id, tripId);
          if (snapshotRevision === null) return null;
          const snapshotId = randomUUID();
          // PGlite's database type includes its client handle while the
          // transaction executor intentionally does not. The manifest readers
          // use only Drizzle query methods, which both objects implement.
          const manifests = await getTripManifests(tx as unknown as AppDb, shop.id, tripId);
          if (!manifests) return null;
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
            () => t("shared.offlineManifest.juniorCheckRequired"),
          );
          return {
            ...payload,
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
    ),
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
  return Response.json(body, { headers: OFFLINE_MANIFEST_NO_STORE });
}

export function GET() {
  return withE2EApiTiming("/api/offline-manifests/upcoming GET", getUpcomingManifests);
}
