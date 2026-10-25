// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  listOfflineManifests,
  loadOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
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
/** Whether the live manifest answers its asks; silent unless a test says so. */
let liveAnswers = false;
const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
  if (String(input) === LIVE) {
    return liveAnswers ? new Response("live", { status: 200 }) : new Promise<Response>(() => {});
  }
  return identityResponse("blue-mantis");
});
const pendingMark = {
  clientEventId: "evt-1",
  snapshotId: "snap-trip-1",
  snapshotSavedAt: new Date(0).toISOString(),
  tripId: "trip-1",
  bookingId: "booking-1",
  checkpoint: "departure" as const,
  status: "boarded" as const,
  occurredAt: new Date(0).toISOString(),
  syncStatus: "pending" as const,
};

/**
 * The header's offer, read from the status line that carries it. The foot's
 * own "Open live manifest" link is always there and is not the offer.
 */
function liveOffer(): HTMLElement | null {
  const said = screen.queryByText(t("shared.offlineManifest.single.liveAnswering"));
  return said?.closest('[role="status"]')?.querySelector("a") ?? null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  // Online, and saved this very minute: the two facts that made the header
  // read "Online · Fresh copy · This copy is current" on a list the worker
  // swapped in because the live one was slow.
  setOnline(true);
  vi.mocked(loadOfflineManifest).mockResolvedValue(envelope("trip-1", "Two-Tank Reef"));
  liveAnswers = false;
  vi.mocked(listOfflineManifests).mockResolvedValue([]);
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

  it("offers the live manifest once DiveDay answers, and never leaves on its own (re-review R1)", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");
    liveAnswers = true;
    const before = window.location.href;
    render(<OfflineManifestView />);
    await screen.findByText(t("shared.connectivity.unansweredWithCopy"));
    expect(liveOffer()).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3));

    expect(liveOffer()).toHaveAttribute("href", LIVE);
    expect(window.location.href).toBe(before);
  });

  it("does not offer the live manifest while a mark on this phone has not reached DiveDay", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");
    liveAnswers = true;
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      envelope("trip-1", "Two-Tank Reef", { events: [pendingMark] }),
    );
    // The sync hangs: the mark stays pending, as it does on a slow link.
    vi.mocked(syncOfflineManifest).mockImplementation(() => new Promise(() => {}));
    render(<OfflineManifestView />);
    await screen.findByText(t("shared.connectivity.unansweredWithCopy"));

    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3));

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(LIVE);
    expect(liveOffer()).toBeNull();
  });

  it("still calls a copy the captain opened online and current", async () => {
    searchParams = new URLSearchParams("trip=trip-1");

    render(<OfflineManifestView />);

    expect(await screen.findByText(/This copy is current/)).toBeInTheDocument();
    // One chip says both (visual review 2026-10-24, B51): fresh, and online.
    expect(
      screen.getByText(t("shared.offlineManifest.freshnessPill.currentOnline")),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("shared.connectivity.online"))).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(LIVE);
  });

  it("keeps the reason on the way from the saved list to a trip (re-review R2)", async () => {
    searchParams = new URLSearchParams("fallback=slow");
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);

    render(<OfflineManifestView />);

    const row = await screen.findByRole("link", { name: /Two-Tank Reef/ });
    expect(row).toHaveAttribute("href", "/offline-manifest?trip=trip-1&fallback=slow");
  });

  it("links a list the captain opened to the trip alone", async () => {
    searchParams = new URLSearchParams();
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);

    render(<OfflineManifestView />);

    const row = await screen.findByRole("link", { name: /Two-Tank Reef/ });
    expect(row).toHaveAttribute("href", "/offline-manifest?trip=trip-1");
  });
});
