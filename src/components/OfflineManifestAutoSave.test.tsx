// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primeOfflineManifestShell, saveOfflineManifest } from "@/lib/offline-manifest-store";
import type { OfflineManifestPayload } from "@/lib/offline-manifests";
import { OfflineManifestAutoSave } from "./OfflineManifestAutoSave";

vi.mock("@/lib/offline-manifest-store", () => ({
  primeOfflineManifestShell: vi.fn(),
  saveOfflineManifest: vi.fn(),
}));

function payloadFor(tripId: string): OfflineManifestPayload {
  return {
    shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
    manifests: [
      {
        trip: {
          id: tripId,
          title: `Trip ${tripId}`,
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T16:30:00.000Z",
          plannedDives: 1,
        },
        checkpoint: "departure",
        crew: [],
        divers: [],
        summary: { totalDivers: 0, ready: 0, blocked: 0, boarded: 0, notBoarded: 0, awaiting: 0 },
      },
    ],
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setOnline(true);
});

describe("OfflineManifestAutoSave", () => {
  it("primes the shell and saves every trip the upcoming endpoint returns", async () => {
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(saveOfflineManifest).mockImplementation(
      (payload) =>
        Promise.resolve({
          snapshot: {
            ...payload,
            version: 3,
            snapshotId: "s",
            savedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 1_000_000).toISOString(),
          },
          events: [],
        }) as never,
    );
    const payloads = [payloadFor("trip-1"), payloadFor("trip-2")];
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ payloads }), { status: 200 }));

    render(<OfflineManifestAutoSave />);

    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledWith(
      "/api/offline-manifests/upcoming",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(
      vi.mocked(saveOfflineManifest).mock.calls.map((call) => call[0].manifests[0].trip.id),
    ).toEqual(["trip-1", "trip-2"]);
  });

  it("never fetches while offline", async () => {
    setOnline(false);
    render(<OfflineManifestAutoSave />);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(primeOfflineManifestShell).not.toHaveBeenCalled();
  });

  it("saves the remaining trips even when one fails", async () => {
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(saveOfflineManifest).mockImplementation((payload) => {
      if (payload.manifests[0].trip.id === "trip-1") {
        return Promise.reject(new Error("storage quota"));
      }
      return Promise.resolve({
        snapshot: {
          ...payload,
          version: 3,
          snapshotId: "s",
          savedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 1_000_000).toISOString(),
        },
        events: [],
      }) as never;
    });
    const payloads = [payloadFor("trip-1"), payloadFor("trip-2")];
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ payloads }), { status: 200 }));

    render(<OfflineManifestAutoSave />);

    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(2));
  });

  it("coalesces overlapping triggers into one in-flight request instead of firing concurrently", async () => {
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    const first = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise);

    render(<OfflineManifestAutoSave />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    // Fired while the mount's own request is still pending — must join it
    // rather than start a second concurrent fetch.
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);

    first.resolve(new Response(JSON.stringify({ payloads: [] }), { status: 200 }));
    await waitFor(() => expect(saveOfflineManifest).not.toHaveBeenCalled());
  });
});
