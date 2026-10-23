// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { loadOfflineManifest } from "@/lib/offline-manifest-store";
import { OfflineManifestView } from "./OfflineManifestView";
import { LIVE_RETRY_MS } from "./offline-manifest/use-live-return";
import { envelope, identityResponse, setOnline } from "./offline-manifest/view-fixtures";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/lib/offline-manifest-store", async () => ({
  OfflineManifestError: (
    await vi.importActual<typeof import("@/lib/offline-manifest-store")>(
      "@/lib/offline-manifest-store",
    )
  ).OfflineManifestError,
  appendOfflineArrival: vi.fn(),
  appendOfflineRollCall: vi.fn(),
  listOfflineManifests: vi.fn().mockResolvedValue([]),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue(undefined),
  syncOfflineManifest: vi.fn(),
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

const t = offlineManifestTranslator("en-US");
const LIVE = "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=departure";
const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
  // The live manifest stays silent: the captain is still on the copy.
  if (String(input) === LIVE) return new Promise<Response>(() => {});
  return identityResponse("blue-mantis");
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  // Online, and saved this very minute: the two facts that made the header
  // read "Online · Fresh copy · This copy is current" on a list the worker
  // swapped in because the live one was slow.
  setOnline(true);
  vi.mocked(loadOfflineManifest).mockResolvedValue(envelope("trip-1", "Two-Tank Reef"));
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * **Captain review B1.** The worker now serves the saved copy when the live
 * manifest is slow, not only when the device is offline. At 07:52 the copy
 * saved at 07:40 has no walk-up seated at 07:50, and the header called it
 * online and current while the departure roll call ran against it.
 */
describe("OfflineManifestView — a copy the worker served because DiveDay did not answer", () => {
  it("says this is the saved list and when it was saved, never that it is online or current", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");

    render(<OfflineManifestView />);

    const banner = await screen.findByText(/DiveDay didn’t answer, so this is the list/);
    expect(banner).toHaveTextContent(/not the live one/);
    expect(screen.getByText(t("shared.connectivity.unansweredWithCopy"))).toBeInTheDocument();
    expect(screen.queryByText(t("shared.connectivity.online"))).not.toBeInTheDocument();
    expect(
      screen.queryByText(t("shared.offlineManifest.freshnessPill.current")),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/This copy is current/)).not.toBeInTheDocument();
  });

  it("keeps asking the live manifest without waiting for an online event", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");
    render(<OfflineManifestView />);
    await screen.findByText(t("shared.connectivity.unansweredWithCopy"));

    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS));

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(LIVE);
  });

  it("still calls a copy the captain opened online and current", async () => {
    searchParams = new URLSearchParams("trip=trip-1");

    render(<OfflineManifestView />);

    expect(await screen.findByText(/This copy is current/)).toBeInTheDocument();
    expect(screen.getByText(t("shared.connectivity.online"))).toBeInTheDocument();
    expect(screen.getByText(t("shared.offlineManifest.freshnessPill.current"))).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(LIVE);
  });
});
