// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  // The version-mismatch banner (task 124) resolves this on mount; no active
  // worker in jsdom, so "nothing to warn about" is the correct default here.
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
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
  opts: {
    savedAt?: string;
    expiresAt?: string;
    events?: OfflineManifestEnvelope["events"];
    shopSlug?: string;
    shopName?: string;
  } = {},
): OfflineManifestEnvelope {
  const base = payload(tripId, title);
  return {
    snapshot: {
      ...base,
      shop:
        opts.shopSlug || opts.shopName
          ? {
              ...base.shop,
              slug: opts.shopSlug ?? base.shop.slug,
              name: opts.shopName ?? base.shop.name,
            }
          : base.shop,
      version: 4,
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

function upcomingResponse(shopSlug: string) {
  return new Response(JSON.stringify({ shop: { slug: shopSlug }, payloads: [] }), { status: 200 });
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  setOnline(true);
  // reconcileList learns "the currently authenticated shop" from this same
  // endpoint before syncing any pending event — default to matching the
  // fixtures' own shop ("blue-mantis") so existing reconcile tests keep
  // working; tests for the cross-shop case override this per-call.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upcomingResponse("blue-mantis")));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OfflineManifestView — list mode (no ?trip=)", () => {
  it("lists every saved trip with its shop, diver count, and freshness pill", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-1", "Two-Tank Reef — Molasses & French", {
        savedAt: new Date(FROZEN_MS).toISOString(),
      }),
    ]);

    render(<OfflineManifestView />);

    expect(await screen.findByText("Two-Tank Reef — Molasses & French")).toBeInTheDocument();
    expect(screen.getByText(/2 divers/)).toBeInTheDocument();
    expect(screen.getByText("Fresh copy")).toBeInTheDocument();
    // Always shown, not only when a foreign shop's record is also present —
    // this view has no reliable way to know "the current shop" while
    // genuinely offline, so the boundary has to be visible unconditionally
    // rather than only when the code happens to be able to tell the two
    // apart (see the cross-shop test below for why this matters).
    expect(screen.getByText(/Blue Mantis Divers/)).toBeInTheDocument();
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
    expect(await screen.findByText("Everything's sent across these trips.")).toBeInTheDocument();
  });

  it("never reconciles a foreign shop's pending trip under the current session", async () => {
    // Submitting shop A's pending event under shop B's session would get it
    // rejected for a tenant mismatch (not a genuine domain refusal), which
    // then makes the next purge treat it as "resolved" and delete it outright
    // — see the cross-shop purge/reconcile follow-up in ADR
    // 20260726-shopwide-offline-manifest-priming.
    const foreignShopEnvelope = envelope("trip-a", "Shop A's Trip", {
      shopSlug: "reef-runners",
      shopName: "Reef Runners",
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: "snap-trip-a",
          snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
          tripId: "trip-a",
          bookingId: "booking-1",
          checkpoint: "departure",
          status: "boarded",
          note: null,
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    });
    vi.mocked(listOfflineManifests).mockResolvedValue([foreignShopEnvelope]);
    // The device is currently signed in as blue-mantis, not reef-runners.
    vi.mocked(fetch).mockResolvedValue(upcomingResponse("blue-mantis"));

    render(<OfflineManifestView />);

    await screen.findByText("Shop A's Trip");
    // A preserved foreign-shop record must never render indistinguishably
    // from the device's own shop's trips — this view can't reliably know
    // "the current shop" while genuinely offline, so the shop name is always
    // shown rather than only when a mismatch happens to be detectable.
    expect(screen.getByText(/Reef Runners/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncOfflineManifest).not.toHaveBeenCalled();
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

  it("re-derives the freshness pill on its periodic tick instead of freezing at mount time", async () => {
    // Freshness is computed inline from the wall clock at render time, so
    // nothing re-renders this component as time passes on its own — capture
    // the interval callback directly (rather than driving real/fake timers,
    // which wouldn't move nowDate()'s frozen-clock reading anyway) and invoke
    // it by hand once the clock has been moved past the "current" threshold,
    // exactly what the real interval does every 60 seconds.
    let tick: (() => void) | undefined;
    const originalSetInterval = globalThis.setInterval;
    vi.stubGlobal("setInterval", ((callback: () => void, ms?: number) => {
      if (ms === 60_000) tick = callback;
      return originalSetInterval(callback, ms);
    }) as typeof setInterval);
    const originalClock = process.env.DIVEDAY_CLOCK;

    try {
      vi.mocked(listOfflineManifests).mockResolvedValue([
        envelope("trip-1", "Two-Tank Reef", {
          savedAt: new Date(FROZEN_MS).toISOString(),
          // Comfortably past the 20-minute mark this test moves the clock to
          // below, so the assertion exercises the freshness *tier* boundary
          // (current → aging) rather than tripping expiry instead.
          expiresAt: new Date(FROZEN_MS + 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]);

      render(<OfflineManifestView />);
      expect(await screen.findByText("Fresh copy")).toBeInTheDocument();

      // 20 minutes later — past the 15-minute "current" threshold — but
      // nothing has re-rendered yet, so the pill should still read stale info.
      process.env.DIVEDAY_CLOCK = new Date(FROZEN_MS + 20 * 60 * 1000).toISOString();
      expect(screen.getByText("Fresh copy")).toBeInTheDocument();

      expect(tick).toBeDefined();
      act(() => tick?.());

      expect(await screen.findByText("Aging copy")).toBeInTheDocument();
    } finally {
      process.env.DIVEDAY_CLOCK = originalClock;
    }
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
