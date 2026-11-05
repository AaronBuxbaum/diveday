import { describe, expect, it } from "vitest";
import {
  medicalAlertWordsOf,
  OFFLINE_FALLBACK_PARAM,
  offlineFallbackReason,
  offlineManifestMayHoldMedicalAlertWords,
  offlineManifestPayloads,
  offlineTripHref,
  withMedicalAlertWords,
} from "./offline-manifests";

type Manifests = Parameters<typeof withMedicalAlertWords>[0];

/** Only the fields these helpers read; the rest of a manifest is not their business. */
const manifestOf = (divers: object[]) => [{ divers }] as unknown as Manifests;

describe("the offline manifest's small pure edges", () => {
  it("names a fallback reason only from the param, and reads anything but 'slow' as failed", () => {
    const reason = (query: string) => offlineFallbackReason(new URLSearchParams(query));
    expect(reason("")).toBeNull();
    expect(reason(`${OFFLINE_FALLBACK_PARAM}=slow`)).toBe("slow");
    expect(reason(`${OFFLINE_FALLBACK_PARAM}=<script>`)).toBe("failed");
  });

  it("keeps the fallback reason on a saved trip's address, and adds none when there is none", () => {
    expect(offlineTripHref("t1", null)).toBe("/offline-manifest?trip=t1");
    expect(offlineTripHref("t1", "slow")).toContain("trip=t1&");
  });

  it("refuses medical alert words from a body that cannot be read", () => {
    const body = { mayHoldMedicalAlertWords: { t1: true, t2: false } };
    expect(offlineManifestMayHoldMedicalAlertWords(body, "t1")).toBe(true);
    expect(offlineManifestMayHoldMedicalAlertWords(body, "t2")).toBe(false);
    expect(offlineManifestMayHoldMedicalAlertWords(body, "t3")).toBe(false);
    expect(offlineManifestMayHoldMedicalAlertWords(body, undefined)).toBe(false);
    expect(offlineManifestMayHoldMedicalAlertWords(null, "t1")).toBe(false);
    expect(offlineManifestMayHoldMedicalAlertWords({}, "t1")).toBe(false);
    expect(offlineManifestMayHoldMedicalAlertWords({ mayHoldMedicalAlertWords: null }, "t1")).toBe(
      false,
    );
    expect(offlineManifestMayHoldMedicalAlertWords({ mayHoldMedicalAlertWords: "t1" }, "t1")).toBe(
      false,
    );
    // A key inherited from the prototype is not an answer about this trip.
    expect(
      offlineManifestMayHoldMedicalAlertWords({ mayHoldMedicalAlertWords: {} }, "toString"),
    ).toBe(false);
  });

  it("takes the board's payloads only when it is an array", () => {
    expect(offlineManifestPayloads(null)).toEqual([]);
    expect(offlineManifestPayloads({})).toEqual([]);
    expect(offlineManifestPayloads({ payloads: "nope" })).toEqual([]);
    expect(offlineManifestPayloads({ payloads: [{ trip: 1 }] })).toEqual([{ trip: 1 }]);
  });

  it("puts a diver's alert words back only by their own booking, and never from the prototype", () => {
    const divers = [
      { bookingId: "a", medicalAlert: {} },
      { bookingId: "b", medicalAlert: {} },
      { bookingId: "toString", medicalAlert: {} },
      { bookingId: "c", medicalAlert: undefined },
    ];
    const [out] = withMedicalAlertWords(manifestOf(divers), { a: "asthma", b: "" });
    expect(out?.divers.map((diver) => diver.medicalAlert)).toEqual([
      { text: "asthma" },
      {},
      {},
      undefined,
    ]);
  });

  it("collects only the words a copy actually carries", () => {
    const manifests = manifestOf([
      { bookingId: "a", medicalAlert: { text: "asthma" } },
      { bookingId: "b", medicalAlert: {} },
      { bookingId: "c" },
    ]);
    expect(medicalAlertWordsOf(manifests)).toEqual({ a: "asthma" });
  });
});
