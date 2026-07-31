// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadOfflineManifest,
  primeOfflineManifestShell,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { OfflineManifestManager, type OfflineManifestManagerCopy } from "./OfflineManifestManager";

const copy: OfflineManifestManagerCopy = {
  checkingDevice: "Checking this device…",
  reconcileRejectedOne: "1 change needs a look — open the live manifest to sort it out.",
  reconcileRejectedOther: "{count} changes need a look — open the live manifest to sort it out.",
  reconcilePendingOne: "1 change is still sending.",
  reconcilePendingOther: "{count} changes are still sending.",
  reconcileCaughtUp: "Everything's sent.",
  reconcileErrorFallback:
    "Couldn't reach DiveDay just now — your offline changes are still saved here and will try to send again on reconnect.",
  savingMessage: "Saving the latest manifest to this device…",
  saveSuccessMessage: "This device has an up-to-date offline copy.",
  saveErrorFallback:
    "This device couldn't save the manifest. It'll try again once you have signal.",
  offlineWithSavedCopy: "Offline — showing the last saved copy.",
  offlineNoSavedCopy: "No offline copy on this device yet.",
  refreshNoSignal: "No signal — showing the last saved copy.",
  heading: "Offline safety copy",
  body: "This device keeps an offline copy of the manifest up to date automatically while you have signal. Roll call keeps working offline, and every change is double-checked against the live manifest once you're back.",
  connectivityOfflineWithCopy: "No signal · device copy",
  connectivityOffline: "No signal",
  connectivityOnline: "Online",
  connectivityOnlineTitle: "This device is online.",
  connectivityOfflineTitle: "This device has no connection right now.",
  freshnessCurrent: "Fresh copy",
  freshnessAging: "Aging copy",
  freshnessStale: "Stale copy",
  savedSummary: "Saved {date} · {pending} waiting to send · {rejected} need a look",
  refreshingLabel: "Refreshing…",
  refreshNowLabel: "Refresh now",
  openOfflineRollCall: "Open offline roll call",
};

// A stable object, not a fresh one per call — real Next.js useRouter()
// returns the same router reference across renders; a fresh object per call
// would make every callback depending on `router` change identity on every
// render, spuriously re-running effects that depend on it (like the mount
// effect below, which lists `reconcile` — and transitively `router` — as a
// dependency).
const mockRouter = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
vi.mock("@/lib/offline-manifest-store", () => ({
  loadOfflineManifest: vi.fn(),
  primeOfflineManifestShell: vi.fn(),
  saveOfflineManifest: vi.fn(),
  syncOfflineManifest: vi.fn(),
}));

const TRIP_ID = "11111111-1111-1111-1111-111111111111";

const payload: OfflineManifestPayload = {
  shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
  manifests: [
    {
      trip: {
        id: TRIP_ID,
        title: "Two-Tank Reef — Molasses & French",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [{ fullName: "Sal Moretti", roles: ["captain"] }],
      divers: [
        {
          bookingId: "22222222-2222-2222-2222-222222222222",
          fullName: "Nora Quinn",
          email: null,
          emergencyContactName: "Sam Quinn",
          emergencyContactPhone: "+1-305-555-0100",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
          rollCall: undefined,
        },
      ],
      summary: { totalDivers: 1, ready: 1, blocked: 0, boarded: 0, notBoarded: 0, awaiting: 1 },
    },
  ],
};

function envelope(events: OfflineManifestEnvelope["events"] = []): OfflineManifestEnvelope {
  return {
    snapshot: {
      ...payload,
      version: 4,
      snapshotId: "snapshot-1",
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1_000_000).toISOString(),
    },
    events,
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setOnline(true);
});

describe("OfflineManifestManager", () => {
  it("coalesces overlapping reconcile triggers into one serialized follow-up instead of firing them concurrently", async () => {
    setOnline(true);
    vi.mocked(loadOfflineManifest).mockResolvedValue(null);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(saveOfflineManifest).mockResolvedValue(envelope());
    // Mount's own save+reconcile settles immediately.
    vi.mocked(syncOfflineManifest).mockResolvedValueOnce(envelope());

    render(<OfflineManifestManager payload={payload} locale="en-US" copy={copy} />);
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(1));

    // From here on, every call hangs until resolved by hand — standing in
    // for the sync route still processing a backlog of offline events (each
    // one publishing its own push signal back to this same device).
    const first = deferred<OfflineManifestEnvelope>();
    vi.mocked(syncOfflineManifest).mockReturnValueOnce(first.promise);

    // A burst of three rapid reconcile triggers (what a run of "manifest
    // changed" pushes looks like from this component's point of view — the
    // `online` event is the easiest one to fire directly in a DOM test, but
    // it funnels through the exact same `refresh` -> `reconcile` path an SSE
    // message would).
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));

    await Promise.resolve();
    await Promise.resolve();
    // Only one new call should have started; the other two triggers must
    // coalesce into a single queued follow-up, not each open their own
    // concurrent sync request against the same still-pending batch.
    expect(syncOfflineManifest).toHaveBeenCalledTimes(2);

    const second = deferred<OfflineManifestEnvelope>();
    vi.mocked(syncOfflineManifest).mockReturnValueOnce(second.promise);
    first.resolve(envelope());

    // The queued follow-up now runs — exactly one more call, not two.
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(3));

    second.resolve(envelope());
    await Promise.resolve();
    await Promise.resolve();
    expect(syncOfflineManifest).toHaveBeenCalledTimes(3);
  });

  // Task 76: the "Saved …" timestamp used to call the bare `toLocaleString()`
  // (the JS runtime's default locale, no shop timezone) — the one date on
  // this whole surface that ignored both the negotiated staff locale and
  // AGENTS.md's "never hard-code a locale" rule. It must render through the
  // same `formatDateTimeTz` + shop timezone every other staff date uses.
  it("formats the saved timestamp for the negotiated locale and shop timezone, not the runtime default", async () => {
    setOnline(true);
    const saved = envelope();
    vi.mocked(loadOfflineManifest).mockResolvedValue(null);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(saveOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValueOnce(saved);

    render(<OfflineManifestManager payload={payload} locale="es-ES" copy={copy} />);
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(1));

    const expected = new Intl.DateTimeFormat("es-ES", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: "America/New_York",
    }).format(new Date(saved.snapshot.savedAt));

    expect(
      await screen.findByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
  });
});
