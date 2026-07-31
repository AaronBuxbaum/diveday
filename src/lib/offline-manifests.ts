import { nowDate } from "./clock";
import type { TripManifest } from "./manifests";
import type { ReadinessBlocker, ReadinessBlockerCode } from "./readiness";

/**
 * Bumped whenever the snapshot shape changes. It is the AES-GCM additional
 * data, so an older cached snapshot fails to decrypt rather than being read
 * back into a type it no longer matches.
 *
 * v3 added the carried-forward (`implied`) flag to roll-call records so a diver
 * who left the boat earlier reads as "not boarded · carried" offline, matching
 * the live manifest, instead of a fabricated explicit result.
 *
 * v4 narrows the diver shape from a deny-list to an explicit allow-list. The
 * bump is doing real work here: age and minor status briefly rode into this
 * payload (see the note on `divers` below), and only a version change purges
 * the copies already written to crew devices — they fail to decrypt and are
 * discarded rather than lingering to their natural 14-day expiry.
 */
export const OFFLINE_MANIFEST_RECORD_VERSION = 4 as const;

/**
 * The offline shell's own cache generation — distinct from
 * `OFFLINE_MANIFEST_RECORD_VERSION` above, which versions the encrypted
 * snapshot payload. This one versions the *app shell itself* (the cached
 * HTML/JS `public/manifest-sw.js` serves while offline) and must be bumped
 * there in lockstep — `CACHE_NAME`'s `-v<n>` suffix — whenever a deploy
 * changes that shell. `manifest-sw.js` is a static file outside the Next.js
 * build, so it can't import this constant directly; the two are compared at
 * runtime instead (`getActiveOfflineShellVersion` in
 * `offline-manifest-store.ts`) to warn a crew member holding a copy of the
 * shell from an older deploy (task 124 / persona 15, Leo) rather than
 * silently serving it with no signal anything's stale.
 */
export const OFFLINE_MANIFEST_SHELL_VERSION = "v1";

export const OFFLINE_MANIFEST_CURRENT_MS = 15 * 60 * 1000;
export const OFFLINE_MANIFEST_AGING_MS = 4 * 60 * 60 * 1000;
export const OFFLINE_MANIFEST_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
// Unchanged at seven days post-trip (owner decision 2026-07-26, H-05): there's
// no manual delete button (ADR 20260726), so this lazy-on-read expiry is the
// only way a device copy goes away once it's no longer needed.
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
      /**
       * An explicit **allow-list**, not `Omit<...>`. It used to be a deny-list,
       * which meant every field later added to a manifest diver silently
       * shipped to every crew phone — that is exactly how H-21's `age`,
       * `minor`, and `birthday` reached this payload, retained for up to 14
       * days on personal devices, rendered by nothing, and describing children.
       * Written this way the next new field fails to compile instead.
       *
       * Only what dock-side roll call actually needs belongs here.
       */
      divers: Array<
        Pick<
          TripManifest["divers"][number],
          | "bookingId"
          | "fullName"
          | "emergencyContactName"
          | "emergencyContactPhone"
          | "rentalFit"
          | "nitroxRequested"
        > & {
          /** Dropped at save time; the dock does not need it (kept for shape parity). */
          email: null;
          /**
           * `text` is resolved once, at save time — this snapshot may be read
           * back with no network and no translator available, so unlike the
           * live manifest it cannot look `code` up lazily.
           */
          readiness: {
            status: "ready" | "blocked";
            blockers: Array<{ code: ReadinessBlockerCode; text: string }>;
          };
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
  /** Same resolver `src/i18n/readiness-labels.ts#readinessBlockerText` gives a caller with a translator. */
  resolveBlockerText: (blocker: ReadinessBlocker) => string,
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
      // Built field-by-field rather than spread, matching the allow-list type
      // above: what the dock needs, and nothing else. Age, minor status, and
      // birthdays (H-21) are deliberately absent — they are staff-screen facts,
      // not something to persist on a deckhand's phone for a fortnight.
      divers: manifest.divers.map((diver) => ({
        bookingId: diver.bookingId,
        fullName: diver.fullName,
        emergencyContactName: diver.emergencyContactName,
        emergencyContactPhone: diver.emergencyContactPhone,
        rentalFit: diver.rentalFit,
        nitroxRequested: diver.nitroxRequested,
        // Not needed for dock-side roll call; minimize retained private data.
        email: null as null,
        readiness: {
          status: diver.readiness.status,
          blockers: diver.readiness.blockers.map((blocker) => ({
            code: blocker.code,
            text: resolveBlockerText(blocker),
          })),
        },
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

/**
 * A record kept past its retention window (because it still holds an
 * unsynced roll-call event — see loadOfflineManifest) is not the same as a
 * current one: the H-05 stop rule treats an expired copy as not a boarding
 * source. Callers use this to keep showing/reconciling the preserved
 * evidence while refusing to record anything new against it.
 */
export function isOfflineManifestExpired(
  snapshot: Pick<OfflineManifestSnapshot, "expiresAt">,
  now: Date = nowDate(),
): boolean {
  return new Date(snapshot.expiresAt) <= now;
}

/**
 * The real fail-closed authority for offline roll call, independent of the
 * UI. Mirrors `recordRollCall`'s server-side gate exactly (src/db/manifests.ts:
 * `if (input.status === "boarded" && checkpoint === "departure")`): readiness
 * blocks boarding only at the "departure" checkpoint. After any numbered dive,
 * boarding is a pure head count — a diver already aboard is recorded present
 * regardless of a paperwork state that changed after the boat left.
 *
 * A missing `checkpoint` argument used to make this the same check at every
 * checkpoint, always keyed off `snapshot.manifests[0]` (whichever manifest
 * happens to be first, always "departure" per `rollCallCheckpoints`) — so an
 * offline board recorded after dive 1 against a not-ready snapshot was
 * silently refused here even though the UI renders a live "Board" button for
 * exactly that case (`ready || !isDeparture` in OfflineManifestView). See the
 * regression test in offline-manifests.test.ts and offline-manifest-store.test.ts.
 */
export function canRecordOfflineStatus(
  snapshot: OfflineManifestSnapshot,
  bookingId: string,
  status: OfflineRollCallEvent["status"],
  checkpoint: OfflineManifestSnapshot["manifests"][number]["checkpoint"],
): boolean {
  const diver = snapshot.manifests[0]?.divers.find((entry) => entry.bookingId === bookingId);
  if (!diver) return false;
  if (status === "not_boarded") return true;
  if (checkpoint !== "departure") return true;
  return diver.readiness.status === "ready";
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
