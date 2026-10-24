import { vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./controls";
import { type OfflineTripView, offlineTripView } from "./trip-view";

/**
 * **One saved copy, drawn a section at a time**: two ready divers and a
 * divemaster on a departure, the controls a section reads, and the view built
 * from them. The whole-screen tests use `view-fixtures.ts`; these are for a
 * test that renders one section alone.
 */

export type Diver = OfflineManifestPayload["manifests"][number]["divers"][number];

export function diver(bookingId: string, fullName: string): Diver {
  return {
    bookingId,
    fullName,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    rollCall: undefined,
  };
}

export function savedCopy(): OfflineManifestEnvelope {
  const divers = [diver("b-priya", "Priya Shah"), diver("b-marcus", "Marcus Reed")];
  return {
    snapshot: {
      shop: {
        slug: "blue-mantis",
        name: "Blue Mantis Divers",
        timezone: "America/New_York",
        emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
      },
      manifests: [
        {
          trip: {
            id: "trip-1",
            title: "Two-Tank Reef",
            startsAt: "2026-08-01T13:00:00.000Z",
            endsAt: "2026-08-01T16:30:00.000Z",
            plannedDives: 1,
          },
          checkpoint: "departure",
          crew: [{ id: "crew-dana", fullName: "Dana Divemaster", roles: ["divemaster"] }],
          divers,
          summary: {
            totalDivers: 2,
            ready: 2,
            blocked: 0,
            boarded: 0,
            notBoarded: 0,
            notBackAboard: 0,
            awaiting: 2,
            unaccountedFor: 2,
            overCapacity: 0,
            notHere: 0,
          },
        },
      ],
      version: 4,
      snapshotId: "snap-trip-1",
      savedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    events: [],
    checklistEvents: [],
  } as OfflineManifestEnvelope;
}

export function controls(): OfflineTripControls {
  return {
    t: offlineManifestTranslator(DEFAULT_DIVER_LOCALE),
    locale: DEFAULT_DIVER_LOCALE,
    message: "",
    setCheckpoint: vi.fn(),
    servedWithoutAnswer: false,
    copyCaveat: null,
    liveOffer: null,
    busyBooking: null,
    busyChecklistItem: null,
    busyArrival: null,
    noteDrafts: {},
    setNoteDrafts: vi.fn(),
    record: vi.fn(async () => {}),
    recordChecklistCheck: vi.fn(async () => {}),
    recordArrival: vi.fn(async () => {}),
  };
}

export function view(): OfflineTripView {
  const found = offlineTripView(savedCopy(), "departure");
  if (!found) throw new Error("the fixture carries a manifest");
  return found;
}
