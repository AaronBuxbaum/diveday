// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listOfflineManifests,
  loadOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { TEST_FROZEN_CLOCK } from "@/test/frozen-clock";
import { OfflineManifestView } from "./OfflineManifestView";

// nowDate() (read by isOfflineManifestExpired/offlineManifestFreshness, both
// imported for real below) resolves to TEST_FROZEN_CLOCK under vitest, not
// wall-clock Date.now() — fixture timestamps must be relative to *this*
// reference or "in the past"/"in the future" assertions are meaningless.
const FROZEN_MS = Date.parse(TEST_FROZEN_CLOCK);

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/offline-manifest-store", () => ({
  appendOfflineRollCall: vi.fn(),
  listOfflineManifests: vi.fn(),
  loadOfflineManifest: vi.fn(),
  syncOfflineManifest: vi.fn(),
}));

function payload(tripId: string, title: string, totalDivers = 2): OfflineManifestPayload {
  return {
    shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
    manifests: [
      {
        trip: {
          id: tripId,
          title,
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T16:30:00.000Z",
          plannedDives: 1,
        },
        checkpoint: "departure",
        crew: [],
        divers: [],
        summary: {
          totalDivers,
          ready: totalDivers,
          blocked: 0,
          boarded: 0,
          notBoarded: 0,
          awaiting: totalDivers,
        },
      },
    ],
  };
}

function envelope(
  tripId: string,
  title: string,
  opts: { savedAt?: string; expiresAt?: string; events?: OfflineManifestEnvelope["events"] } = {},
): OfflineManifestEnvelope {
  return {
    snapshot: {
      ...payload(tripId, title),
      version: 3,
      snapshotId: `snap-${tripId}`,
      savedAt: opts.savedAt ?? new Date(FROZEN_MS).toISOString(),
      expiresAt: opts.expiresAt ?? new Date(FROZEN_MS + 1_000_000).toISOString(),
    },
    events: opts.events ?? [],
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OfflineManifestView — list mode (no ?trip=)", () => {
  it("lists every saved trip with its diver count and freshness pill", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-1", "Two-Tank Reef — Molasses & French", {
        savedAt: new Date(FROZEN_MS).toISOString(),
      }),
    ]);

    render(<OfflineManifestView />);

    expect(await screen.findByText("Two-Tank Reef — Molasses & French")).toBeInTheDocument();
    expect(screen.getByText(/2 divers/)).toBeInTheDocument();
    expect(screen.getByText("Fresh copy")).toBeInTheDocument();
  });

  it("labels a record kept alive only for a pending event as expired, not as an ordinary stale copy", async () => {
    const longAgo = new Date(FROZEN_MS - 30 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-1", "Old Trip", {
        savedAt: longAgo,
        expiresAt: new Date(FROZEN_MS - 1000).toISOString(),
        events: [
          {
            clientEventId: "evt-1",
            snapshotId: "snap-trip-1",
            snapshotSavedAt: longAgo,
            tripId: "trip-1",
            bookingId: "booking-1",
            checkpoint: "departure",
            status: "boarded",
            note: null,
            occurredAt: longAgo,
            syncStatus: "pending",
          },
        ],
      }),
    ]);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);

    expect(await screen.findByText("Expired — view only")).toBeInTheDocument();
    expect(screen.queryByText("Stale copy")).not.toBeInTheDocument();
  });

  it("reconciles every listed trip with a pending event on initial load, not just one a captain opens", async () => {
    const saved = envelope("trip-1", "Two-Tank Reef", {
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: "snap-trip-1",
          snapshotSavedAt: new Date().toISOString(),
          tripId: "trip-1",
          bookingId: "booking-1",
          checkpoint: "departure",
          status: "boarded",
          note: null,
          occurredAt: new Date().toISOString(),
          syncStatus: "pending",
        },
      ],
    });
    vi.mocked(listOfflineManifests).mockResolvedValue([saved]);
    const reconciled: OfflineManifestEnvelope = {
      ...saved,
      events: [{ ...saved.events[0], syncStatus: "applied" }],
    };
    vi.mocked(syncOfflineManifest).mockResolvedValue(reconciled);

    render(<OfflineManifestView />);

    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledWith("trip-1"));
    expect(
      await screen.findByText(
        "Every offline change across these trips is caught up with the live manifest.",
      ),
    ).toBeInTheDocument();
  });

  it("does not attempt to reconcile while offline", async () => {
    setOnline(false);
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-1", "Two-Tank Reef", {
        events: [
          {
            clientEventId: "evt-1",
            snapshotId: "snap-trip-1",
            snapshotSavedAt: new Date().toISOString(),
            tripId: "trip-1",
            bookingId: "booking-1",
            checkpoint: "departure",
            status: "boarded",
            note: null,
            occurredAt: new Date().toISOString(),
            syncStatus: "pending",
          },
        ],
      }),
    ]);

    render(<OfflineManifestView />);

    await screen.findByText("Two-Tank Reef");
    expect(syncOfflineManifest).not.toHaveBeenCalled();
  });

  it("shows the empty state when nothing is saved on this device", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([]);

    render(<OfflineManifestView />);

    expect(await screen.findByText("Nothing saved on this device yet")).toBeInTheDocument();
  });
});

describe("OfflineManifestView — single-trip mode (?trip=)", () => {
  it("still opens a specific trip's roll call unchanged", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope("trip-1", "Two-Tank Reef"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);

    expect(await screen.findByRole("heading", { name: "Two-Tank Reef" })).toBeInTheDocument();
  });
});
