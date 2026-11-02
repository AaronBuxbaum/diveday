// @vitest-environment jsdom
// Browser-side store: the medical alerts' words on a device copy (H-20261023-medical-alert-for-the amendment).
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { forgetThisDevice } from "@/components/forget-device";
import {
  appendOfflineRollCall,
  listOfflineManifests,
  loadOfflineManifest,
  saveOfflineManifest,
  saveOfflineMedicalAlerts,
  wipeOfflineMedicalAlerts,
} from "./offline-manifest-store";
import {
  type OfflineManifestPayload,
  offlineManifestMayHoldMedicalAlertWords,
} from "./offline-manifests";

const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";
const ALERTED = "22222222-2222-2222-2222-222222222222";
const PLAIN = "55555555-5555-5555-5555-555555555555";
const DIVEMASTER = {
  personId: "66666666-6666-6666-6666-666666666666",
  name: "Yusra Idrissi",
  savedAt: "2026-07-31T11:00:00.000Z",
};

function diver(bookingId: string, fullName: string, alerted: boolean) {
  return {
    bookingId,
    fullName,
    email: null,
    emergencyContactName: "Sam Quinn",
    emergencyContactPhone: "+1-305-555-0100",
    readiness: { status: "ready" as const, blockers: [] },
    rentalFit: { state: "not_recorded" as const },
    nitroxRequested: false,
    rollCall: undefined,
    ...(alerted ? { medicalAlert: {} } : {}),
  };
}

function payloadFor(tripId: string): OfflineManifestPayload {
  return {
    shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
    manifests: [
      {
        trip: {
          id: tripId,
          title: "Morning Two-Tank — Molasses Reef",
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T16:30:00.000Z",
          plannedDives: 2,
        },
        checkpoint: "departure",
        crew: [],
        divers: [diver(ALERTED, "Siobhan Doyle", true), diver(PLAIN, "Nora Quinn", false)],
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
  };
}

const TRIP = "11111111-1111-1111-1111-111111111111";
const OTHER_TRIP = "33333333-3333-3333-3333-333333333333";

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

const words = (envelope: Awaited<ReturnType<typeof loadOfflineManifest>>) =>
  envelope?.snapshot.manifests[0]?.divers.map((row) => row.medicalAlert);

describe("the medical alerts' words on a device copy", () => {
  it("never keeps words a payload carried: only an explicit save puts them on", async () => {
    const payload = payloadFor(TRIP);
    const smuggled = structuredClone(payload);
    const first = smuggled.manifests[0]?.divers[0];
    if (first) first.medicalAlert = { text: ALERT };
    const saved = await saveOfflineManifest(smuggled);
    expect(JSON.stringify(saved)).not.toContain("EpiPen");
    expect(saved.medicalAlertsSavedBy).toBeUndefined();
  });

  it("puts the words on flagged divers only, and records who saved them", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    const saved = await saveOfflineMedicalAlerts(
      TRIP,
      { [ALERTED]: ALERT, [PLAIN]: "never flagged, never carried" },
      DIVEMASTER,
    );
    expect(words(saved)).toEqual([{ text: ALERT }, undefined]);
    expect(saved?.medicalAlertsSavedBy).toEqual(DIVEMASTER);
    expect(words(await loadOfflineManifest(TRIP))).toEqual([{ text: ALERT }, undefined]);
  });

  it("has nothing to put words on before the copy exists", async () => {
    expect(await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER)).toBeNull();
    expect(await loadOfflineManifest(TRIP)).toBeNull();
  });

  it("keeps the saved words through a background refresh, for a diver still flagged", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    const refreshed = await saveOfflineManifest(payloadFor(TRIP));
    expect(words(refreshed)).toEqual([{ text: ALERT }, undefined]);
    expect(refreshed.medicalAlertsSavedBy).toEqual(DIVEMASTER);
    // The diver re-signed with no alert: the board drops the flag, and the
    // words go with it.
    const cleared = payloadFor(TRIP);
    const row = cleared.manifests[0]?.divers[0];
    if (row) delete row.medicalAlert;
    const after = await saveOfflineManifest(cleared);
    expect(JSON.stringify(after)).not.toContain("EpiPen");
    expect(after.medicalAlertsSavedBy).toBeUndefined();
  });

  it("drops the saved words on a background refresh once the viewer may no longer hold them (security review 2, L3)", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    // Still on the crew: the refresh keeps them.
    const crewing = { payloads: [], mayHoldMedicalAlertWords: { [TRIP]: true } };
    const kept = await saveOfflineManifest(payloadFor(TRIP), {
      keepMedicalAlertWords: offlineManifestMayHoldMedicalAlertWords(crewing, TRIP),
    });
    expect(words(kept)).toEqual([{ text: ALERT }, undefined]);
    // Taken off the boat: the next refresh drops the words, keeps the fact.
    const removed = { payloads: [], mayHoldMedicalAlertWords: { [TRIP]: false } };
    const after = await saveOfflineManifest(payloadFor(TRIP), {
      keepMedicalAlertWords: offlineManifestMayHoldMedicalAlertWords(removed, TRIP),
    });
    expect(JSON.stringify(after)).not.toContain("EpiPen");
    expect(after.medicalAlertsSavedBy).toBeUndefined();
    expect(words(after)).toEqual([{}, undefined]);
    expect(JSON.stringify(await loadOfflineManifest(TRIP))).not.toContain("EpiPen");
  });

  it("reads a missing or malformed answer as may not hold them", () => {
    expect(offlineManifestMayHoldMedicalAlertWords({}, TRIP)).toBe(false);
    expect(offlineManifestMayHoldMedicalAlertWords(null, TRIP)).toBe(false);
    expect(
      offlineManifestMayHoldMedicalAlertWords(
        { mayHoldMedicalAlertWords: { [TRIP]: "yes" } },
        TRIP,
      ),
    ).toBe(false);
    expect(
      offlineManifestMayHoldMedicalAlertWords(
        { mayHoldMedicalAlertWords: { [TRIP]: true } },
        OTHER_TRIP,
      ),
    ).toBe(false);
    expect(
      offlineManifestMayHoldMedicalAlertWords(
        { mayHoldMedicalAlertWords: { [TRIP]: true } },
        undefined,
      ),
    ).toBe(false);
  });

  it("wipes the words from every copy on sign-out, keeping the rest of each copy", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineManifest(payloadFor(OTHER_TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    await saveOfflineMedicalAlerts(OTHER_TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    // A roll call taken at sea and not yet synced must survive the wipe.
    await appendOfflineRollCall(TRIP, {
      bookingId: ALERTED,
      checkpoint: "departure",
      status: "boarded",
    });

    await wipeOfflineMedicalAlerts();

    const copies = await listOfflineManifests();
    expect(copies).toHaveLength(2);
    expect(JSON.stringify(copies)).not.toContain("EpiPen");
    for (const copy of copies) {
      expect(copy.medicalAlertsSavedBy).toBeUndefined();
      // The fact stays, so the chip still shows.
      expect(words(copy)).toEqual([{}, undefined]);
      expect(copy.snapshot.manifests[0]?.divers[0]?.emergencyContactPhone).toBe("+1-305-555-0100");
    }
    const tripCopy = copies.find((copy) => copy.snapshot.manifests[0]?.trip.id === TRIP);
    expect(tripCopy?.events.map((event) => event.status)).toEqual(["boarded"]);
  });

  it("wipes another person's words when someone else signs in, and keeps the signed-in person's own", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineManifest(payloadFor(OTHER_TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    const captain = { ...DIVEMASTER, personId: "77777777-7777-7777-7777-777777777777" };
    await saveOfflineMedicalAlerts(OTHER_TRIP, { [ALERTED]: ALERT }, captain);

    await wipeOfflineMedicalAlerts(captain.personId);

    expect(words(await loadOfflineManifest(TRIP))).toEqual([{}, undefined]);
    expect((await loadOfflineManifest(TRIP))?.medicalAlertsSavedBy).toBeUndefined();
    const kept = await loadOfflineManifest(OTHER_TRIP);
    expect(words(kept)).toEqual([{ text: ALERT }, undefined]);
    expect(kept?.medicalAlertsSavedBy).toEqual(captain);
  });

  it("is what signing out runs (`forgetThisDevice`, both sign-out doors and the sign-in page)", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    // Awaitable (security review 2, L4): both sign-out doors wait for it.
    await forgetThisDevice();
    expect((await loadOfflineManifest(TRIP))?.medicalAlertsSavedBy).toBeUndefined();
    expect(JSON.stringify(await loadOfflineManifest(TRIP))).not.toContain("EpiPen");
  });
});
