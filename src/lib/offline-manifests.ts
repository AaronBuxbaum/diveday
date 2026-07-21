import { nowDate } from "./clock";
import type { TripManifest } from "./manifests";

/**
 * Bumped whenever the snapshot shape changes. It is the AES-GCM additional
 * data, so an older cached snapshot fails to decrypt rather than being read
 * back into a type it no longer matches.
 *
 * v3 adds the carried-forward (`implied`) flag to roll-call records so a diver
 * who left the boat earlier reads as "not boarded · carried" offline, matching
 * the live manifest, instead of a fabricated explicit result.
 */
export const OFFLINE_MANIFEST_RECORD_VERSION = 3 as const;
export const OFFLINE_MANIFEST_CURRENT_MS = 15 * 60 * 1000;
export const OFFLINE_MANIFEST_AGING_MS = 4 * 60 * 60 * 1000;
export const OFFLINE_MANIFEST_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const OFFLINE_MANIFEST_POST_TRIP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineManifestFreshness = "current" | "aging" | "stale";

export type OfflineManifestPayload = {
  shop: { slug: string; name: string; timezone: string };
  manifests: Array<
    Omit<TripManifest, "trip" | "divers"> & {
      trip: Omit<TripManifest["trip"], "startsAt" | "endsAt"> & {
        startsAt: string;
        endsAt: string;
      };
      divers: Array<
        Omit<TripManifest["divers"][number], "rollCall" | "medicalWaiver"> & {
          rollCall?: {
            state: "boarded" | "not_boarded";
            occurredAt: string;
            recordedByName: string;
            note: string | null;
            /** Carried forward from an earlier checkpoint, not recorded here. */
            implied?: boolean;
          };
        }
      >;
    }
  >;
};

export type OfflineManifestSnapshot = OfflineManifestPayload & {
  version: typeof OFFLINE_MANIFEST_RECORD_VERSION;
  snapshotId: string;
  savedAt: string;
  expiresAt: string;
};

export type OfflineRollCallEvent = {
  clientEventId: string;
  snapshotId: string;
  snapshotSavedAt: string;
  tripId: string;
  bookingId: string;
  checkpoint: TripManifest["checkpoint"];
  status: "boarded" | "not_boarded";
  note: string | null;
  occurredAt: string;
  syncStatus: "pending" | "applied" | "rejected";
  rejectionReason?: string;
};

export type OfflineManifestEnvelope = {
  snapshot: OfflineManifestSnapshot;
  events: OfflineRollCallEvent[];
};

export function serializeManifests(
  manifests: readonly TripManifest[],
  shop: OfflineManifestPayload["shop"],
): OfflineManifestPayload {
  return {
    shop,
    manifests: manifests.map((manifest) => ({
      ...manifest,
      trip: {
        ...manifest.trip,
        startsAt: manifest.trip.startsAt.toISOString(),
        endsAt: manifest.trip.endsAt.toISOString(),
      },
      divers: manifest.divers.map(({ medicalWaiver: _medicalWaiver, ...diver }) => ({
        ...diver,
        // Email is not needed for dock-side roll call; minimize retained private data.
        email: null,
        rollCall: diver.rollCall
          ? {
              state: diver.rollCall.state,
              occurredAt: diver.rollCall.occurredAt.toISOString(),
              recordedByName: diver.rollCall.recordedByName,
              note: diver.rollCall.note,
              // Preserve the carried-forward default so it never reads as an
              // explicit dock-side result the crew did not actually record.
              implied: diver.rollCall.implied ?? false,
            }
          : undefined,
      })),
    })),
  };
}

export function offlineManifestExpiresAt(savedAt: Date, tripEndsAt: Date): Date {
  return new Date(
    Math.min(
      savedAt.getTime() + OFFLINE_MANIFEST_MAX_RETENTION_MS,
      tripEndsAt.getTime() + OFFLINE_MANIFEST_POST_TRIP_RETENTION_MS,
    ),
  );
}

export function offlineManifestFreshness(
  savedAt: Date,
  now: Date = nowDate(),
): OfflineManifestFreshness {
  const age = Math.max(0, now.getTime() - savedAt.getTime());
  if (age <= OFFLINE_MANIFEST_CURRENT_MS) return "current";
  if (age <= OFFLINE_MANIFEST_AGING_MS) return "aging";
  return "stale";
}

export function canRecordOfflineStatus(
  snapshot: OfflineManifestSnapshot,
  bookingId: string,
  status: OfflineRollCallEvent["status"],
): boolean {
  const diver = snapshot.manifests[0]?.divers.find((entry) => entry.bookingId === bookingId);
  if (!diver) return false;
  return status === "not_boarded" || diver.readiness.status === "ready";
}

export function latestOfflineRollCall(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  bookingId: string,
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
):
  | { state: "boarded" | "not_boarded"; occurredAt: string; pending: boolean; implied: boolean }
  | undefined {
  const local = events
    .filter(
      (event) =>
        event.bookingId === bookingId &&
        event.checkpoint === checkpoint &&
        event.syncStatus !== "rejected",
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (local) {
    // A result recorded on this device at this checkpoint is always explicit.
    return {
      state: local.status,
      occurredAt: local.occurredAt,
      pending: local.syncStatus === "pending",
      implied: false,
    };
  }
  const server = snapshot.manifests
    .find((manifest) => manifest.checkpoint === checkpoint)
    ?.divers.find((entry) => entry.bookingId === bookingId)?.rollCall;
  return server
    ? {
        state: server.state,
        occurredAt: server.occurredAt,
        pending: false,
        implied: server.implied ?? false,
      }
    : undefined;
}
