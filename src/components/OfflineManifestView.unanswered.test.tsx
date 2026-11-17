// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  appendOfflineArrival,
  appendOfflineRollCall,
  listOfflineManifests,
  loadOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import { OfflineManifestView } from "./OfflineManifestView";
import { LIVE_RETRY_MS } from "./offline-manifest/use-live-return";
import {
  envelope,
  identityResponse,
  richEnvelope,
  setOnline,
} from "./offline-manifest/view-fixtures";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/offline-manifest",
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/offline-manifest-store", async () => ({
  OfflineManifestError: (
    await vi.importActual<typeof import("@/lib/offline-manifest-store")>(
      "@/lib/offline-manifest-store",
    )
  ).OfflineManifestError,
  appendOfflineArrival: vi.fn(),
  appendOfflineRollCall: vi.fn(),
  beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
  listOfflineManifests: vi.fn().mockResolvedValue([]),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue([]),
  syncOfflineManifest: vi.fn(),
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
}));

const t = offlineManifestTranslator("en-US");
const LIVE = "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=departure";
/** Whether the live manifest answers its asks; silent unless a test says so. */
let liveAnswers = false;
const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
  if (String(input) === LIVE || String(input) === LIVE.replace("departure", "after_dive_1")) {
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

/** Delivery feedback stays visible on the routine Deck, outside its reference disclosure. */
async function routineStatus() {
  const deck = await screen.findByRole("region", { name: "Roll call" });
  const status = deck.querySelector<HTMLDivElement>(':scope > div[role="status"]');
  if (!status) throw new Error("Expected the routine Deck delivery status");
  expect(status).toBeVisible();
  return within(status);
}

async function openDetails() {
  await screen.findByRole("region", { name: "Roll call" });
  fireEvent.click(screen.getByText("More", { selector: "summary" }));
}

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
  // read "Online · Fresh copy · The saved manifest is current" on a list the worker
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

    const status = await routineStatus();
    expect(status.getByText(t("shared.connectivity.unansweredWithCopy"))).toBeVisible();
    await openDetails();
    const banner = await screen.findByText(/DiveDay didn’t answer, so this is the list/);
    expect(banner).toHaveTextContent(/not the live one/);
    expect(banner).toBeVisible();
    expect(screen.queryByText(t("shared.connectivity.online"))).not.toBeInTheDocument();
    expect(
      screen.queryByText(t("shared.offlineManifest.freshnessPill.current")),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/The saved manifest is current/)).not.toBeInTheDocument();
  });

  it("keeps asking the live manifest without waiting for an online event", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");
    render(<OfflineManifestView />);
    const status = await routineStatus();
    expect(status.getByText(t("shared.connectivity.unansweredWithCopy"))).toBeVisible();

    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS));

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(LIVE);
  });

  it("offers the live manifest once DiveDay answers, and never leaves on its own (re-review R1)", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");
    liveAnswers = true;
    const before = window.location.href;
    render(<OfflineManifestView />);
    const status = await routineStatus();
    expect(status.getByText(t("shared.connectivity.unansweredWithCopy"))).toBeVisible();
    expect(liveOffer()).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3));

    expect(liveOffer()).toHaveAttribute("href", LIVE);
    expect(liveOffer()).toBeVisible();
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
    const status = await routineStatus();
    expect(status.getByText(t("shared.connectivity.unansweredWithCopy"))).toBeVisible();

    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3));

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(LIVE);
    expect(liveOffer()).toBeNull();
  });

  it("withholds the live offer while a named person's mark is being saved and while it waits to send", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");
    liveAnswers = true;
    const saved = richEnvelope("trip-1");
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockImplementation(() => new Promise(() => {}));
    let finish!: (value: typeof saved) => void;
    vi.mocked(appendOfflineRollCall).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<OfflineManifestView />);
    await routineStatus();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3));
    expect(liveOffer()).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    fireEvent.click(screen.getByRole("button", { name: "Priya Shah" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Priya Shah aboard" }));
    expect(liveOffer()).toBeNull();
    await act(async () =>
      finish({ ...saved, events: [{ ...pendingMark, bookingId: "diver-priya" }] }),
    );
    expect(liveOffer()).toBeNull();
  });

  it("withholds the live offer while a person's unsent note is in the device's memory", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow&checkpoint=after_dive_1");
    liveAnswers = true;
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    render(<OfflineManifestView />);
    await routineStatus();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3));
    expect(liveOffer()).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    fireEvent.click(screen.getByRole("button", { name: "Priya Shah" }));
    fireEvent.click(screen.getByRole("button", { name: t("manifest.deck.exception") }));
    const panel = document.querySelector<HTMLDetailsElement>("details[data-roll-call-exception]");
    if (!panel) throw new Error("Missing exception panel");
    fireEvent.click(panel.querySelector("summary") as HTMLElement);
    fireEvent.change(within(panel).getByRole("textbox"), {
      target: { value: "Last seen near the buoy" },
    });
    expect(liveOffer()).toBeNull();
  });

  it("keeps the live offer hidden when a later arrival fails before an earlier save completes", async () => {
    searchParams = new URLSearchParams("trip=trip-1&fallback=slow");
    liveAnswers = true;
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { withCarriedNotBoarded: true }),
    );
    let failSecond!: (error: Error) => void;
    vi.mocked(appendOfflineArrival)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failSecond = reject;
          }),
      );
    render(<OfflineManifestView />);
    await routineStatus();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3));
    expect(liveOffer()).toBeVisible();
    await openDetails();
    fireEvent.click(screen.getByRole("button", { name: "Priya Shah Check in" }));
    fireEvent.click(screen.getByRole("button", { name: "Marcus Reed Check in" }));
    expect(appendOfflineArrival).toHaveBeenCalledTimes(2);
    await act(async () => failSecond(new Error("write failed")));
    expect(liveOffer()).toBeNull();
  });

  it("still calls a copy the captain opened online and current", async () => {
    searchParams = new URLSearchParams("trip=trip-1");

    render(<OfflineManifestView />);

    await openDetails();
    expect(await screen.findByText(/The saved manifest is current/)).toBeVisible();
    // One chip says both (visual review 2026-10-24, B51): fresh, and online.
    expect(
      screen.getByText(t("shared.offlineManifest.freshnessPill.currentOnline")),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("shared.connectivity.online"))).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(LIVE);
  });

  it("says No signal on a copy opened with no signal, never a green Fresh copy alone (review dde-b 1)", async () => {
    searchParams = new URLSearchParams("trip=trip-1");
    setOnline(false);

    render(<OfflineManifestView />);

    await openDetails();
    expect(await screen.findByText(t("shared.connectivity.offlineWithCopy"))).toBeVisible();
    // The age is still said, in the banner, once.
    expect(screen.getByText(/The saved manifest is current/)).toBeInTheDocument();
    expect(
      screen.queryByText(t("shared.offlineManifest.freshnessPill.current")),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t("shared.offlineManifest.freshnessPill.currentOnline")),
    ).not.toBeInTheDocument();
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
