import type { TripManifest } from "./manifests";

export const OFFLINE_MANIFEST_RECORD_VERSION = 1 as const;
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
        Omit<TripManifest["divers"][number], "rollCall"> & {
          rollCall?: {
            state: "boarded" | "not_boarded";
            occurredAt: string;
            recordedByName: string;
            note: string | null;
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
      divers: manifest.divers.map((diver) => ({
        ...diver,
        rollCall: diver.rollCall
          ? { ...diver.rollCall, occurredAt: diver.rollCall.occurredAt.toISOString() }
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
  now: Date = new Date(),
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
): { state: "boarded" | "not_boarded"; occurredAt: string; pending: boolean } | undefined {
  const local = events
    .filter(
      (event) =>
        event.bookingId === bookingId &&
        event.checkpoint === checkpoint &&
        event.syncStatus !== "rejected",
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (local) {
    return {
      state: local.status,
      occurredAt: local.occurredAt,
      pending: local.syncStatus === "pending",
    };
  }
  const server = snapshot.manifests
    .find((manifest) => manifest.checkpoint === checkpoint)
    ?.divers.find((entry) => entry.bookingId === bookingId)?.rollCall;
  return server
    ? { state: server.state, occurredAt: server.occurredAt, pending: false }
    : undefined;
}
