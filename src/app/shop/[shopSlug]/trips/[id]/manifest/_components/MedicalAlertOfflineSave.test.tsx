// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";

vi.mock("@/lib/offline-manifest-store", () => ({
  beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
  loadOfflineManifest: vi.fn(async () => null),
  saveOfflineMedicalAlerts: vi.fn(async () => null),
}));
const store = await import("@/lib/offline-manifest-store");
const { MedicalAlertOfflineSave } = await import("./MedicalAlertOfflineSave");

const copy = {
  heading: "Medical alerts on this phone",
  body: "Save the words too.",
  button: "Save the medical alerts for offline",
  saving: "Saving the alerts…",
  done: "This phone’s copy has the words, saved by {name}.",
  noCopy: "This phone has no copy of the trip yet.",
  failed: "The alerts didn’t save.",
};
const SAVED_BY = { personId: "p-1", name: "Yusra Idrissi", savedAt: "2026-07-21T11:00:00.000Z" };
const copyOnPhone = (savedBy?: typeof SAVED_BY) =>
  ({
    snapshot: { manifests: [] },
    events: [],
    checklistEvents: [],
    ...(savedBy ? { medicalAlertsSavedBy: savedBy } : {}),
  }) as unknown as OfflineManifestEnvelope;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(store.loadOfflineManifest).mockReset();
  vi.mocked(store.loadOfflineManifest).mockResolvedValue(null);
  vi.mocked(store.saveOfflineMedicalAlerts).mockReset();
});

async function tapSave() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: copy.button }));
  });
}

/** H-153 amendment: the words reach this phone only on this tap. */
describe("MedicalAlertOfflineSave", () => {
  it("asks the gated route, puts the words on this phone's copy and says who saved them", async () => {
    vi.mocked(store.loadOfflineManifest).mockResolvedValue(copyOnPhone());
    vi.mocked(store.saveOfflineMedicalAlerts).mockResolvedValue(copyOnPhone(SAVED_BY));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ texts: { "b-1": "Bee-sting allergy." }, savedBy: SAVED_BY }),
      );
    render(<MedicalAlertOfflineSave tripId="trip-1" copy={copy} />);
    await tapSave();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/offline-manifests/trip-1/medical-alerts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(store.saveOfflineMedicalAlerts).toHaveBeenCalledWith(
      "trip-1",
      { "b-1": "Bee-sting allergy." },
      SAVED_BY,
      1,
    );
    expect(
      await screen.findByText("This phone’s copy has the words, saved by Yusra Idrissi."),
    ).toBeInTheDocument();
  });

  it("never asks for the words before this phone holds the trip", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<MedicalAlertOfflineSave tripId="trip-1" copy={copy} />);
    await tapSave();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(copy.noCopy)).toBeInTheDocument();
  });

  it("says the save failed when the route refuses or the call never lands", async () => {
    vi.mocked(store.loadOfflineManifest).mockResolvedValue(copyOnPhone());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 403 }));
    render(<MedicalAlertOfflineSave tripId="trip-1" copy={copy} />);
    await tapSave();
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.failed);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await tapSave();
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.failed);
    expect(store.saveOfflineMedicalAlerts).not.toHaveBeenCalled();
  });

  it("says so when this phone's copy already has the words", async () => {
    vi.mocked(store.loadOfflineManifest).mockResolvedValue(copyOnPhone(SAVED_BY));
    render(<MedicalAlertOfflineSave tripId="trip-1" copy={copy} />);
    expect(
      await screen.findByText("This phone’s copy has the words, saved by Yusra Idrissi."),
    ).toBeInTheDocument();
  });
});
