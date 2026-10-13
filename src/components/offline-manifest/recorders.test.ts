import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { appendOfflineRollCall, OfflineManifestError } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { offlineRecorders } from "./recorders";
import { savedCopy } from "./section-fixtures";

vi.mock("@/lib/offline-manifest-store", async (original) => ({
  ...(await original<typeof import("@/lib/offline-manifest-store")>()),
  appendOfflineRollCall: vi.fn(),
  appendOfflineChecklistCheck: vi.fn(),
  appendOfflineArrival: vi.fn(),
}));

const t = offlineManifestTranslator("en-US");
const append = vi.mocked(appendOfflineRollCall);

function recorders({ expired = false, checkpoint = "after_dive_1" as const } = {}) {
  const spies = {
    setNoteDrafts: vi.fn(),
    setBusyBooking: vi.fn(),
    setBusyChecklistItem: vi.fn(),
    setBusyArrival: vi.fn(),
    dispatchSaved: vi.fn(),
    setMessage: vi.fn(),
    reconcile: vi.fn(async () => {}),
  };
  const taps = offlineRecorders({
    t,
    tripId: "trip-1",
    envelope: savedCopy(),
    checkpoint,
    expired,
    noteDrafts: { "b-priya": "  surfaced north  " },
    ...spies,
  });
  return { taps, spies };
}

beforeEach(() => {
  append.mockReset();
  vi.stubGlobal("navigator", { onLine: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("offlineRecorders' roll-call tap", () => {
  it("queues nothing on an expired copy, and says why", async () => {
    const { taps, spies } = recorders({ expired: true });
    await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
    expect(append).not.toHaveBeenCalled();
    expect(spies.setMessage).toHaveBeenCalledWith(
      t("shared.offlineManifest.single.record.expiredCannotRecord"),
    );
  });

  it("carries the row's sentence on a not-aboard after a dive, and clears the draft once it went", async () => {
    append.mockResolvedValue(savedCopy() as OfflineManifestEnvelope);
    const { taps, spies } = recorders();
    await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
    expect(append).toHaveBeenCalledWith(
      "trip-1",
      expect.objectContaining({
        bookingId: "b-priya",
        status: "not_boarded",
        note: "surfaced north",
      }),
    );
    expect(spies.setNoteDrafts).toHaveBeenCalledTimes(1);
    expect(spies.setMessage).toHaveBeenCalledWith(t("shared.offlineManifest.single.record.saved"));
    expect(spies.setBusyBooking).toHaveBeenLastCalledWith(null);
  });

  it("says the store's refusal in its own words and keeps the draft", async () => {
    append.mockRejectedValue(new OfflineManifestError("not_allowed"));
    const { taps, spies } = recorders();
    await taps.record({ bookingId: "b-priya" }, { status: "not_boarded" });
    expect(spies.setMessage).toHaveBeenCalledWith(
      t("shared.offlineManifest.single.record.notAllowed"),
    );
    expect(spies.setNoteDrafts).not.toHaveBeenCalled();
    expect(spies.setBusyBooking).toHaveBeenLastCalledWith(null);
  });
});
