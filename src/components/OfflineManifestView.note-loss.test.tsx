// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeDiscardedOfflineRecords,
  listOfflineManifests,
  loadOfflineManifest,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import { OfflineManifestView } from "./OfflineManifestView";
import { envelope, FROZEN_MS, identityResponse, setOnline } from "./offline-manifest/view-fixtures";

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
  listOfflineManifests: vi.fn(),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue(undefined),
  syncOfflineManifest: vi.fn(),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  searchParams = new URLSearchParams();
  setOnline(true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => identityResponse("blue-mantis")),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OfflineManifestView note-loss status", () => {
  it("does not call current snapshots all up to date when a saved note was removed", async () => {
    const saved = envelope("trip-loss", "Synthetic saved trip");
    saved.events = [
      {
        clientEventId: "loss-roll-call",
        snapshotId: "snap-trip-loss",
        snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
        tripId: "trip-loss",
        bookingId: "booking-12345678",
        checkpoint: "departure",
        status: "boarded",
        note: null,
        occurredAt: new Date(FROZEN_MS).toISOString(),
        syncStatus: "applied",
        noteDisposition: "discarded_erasure_cutoff",
      },
    ];
    vi.mocked(listOfflineManifests).mockResolvedValue([saved]);

    const rendered = render(<OfflineManifestView />);

    expect(
      await screen.findByText(/Older offline note text was removed after a data erasure/),
    ).toBeInTheDocument();
    expect(screen.queryByText("All up to date.")).not.toBeInTheDocument();
    expect(screen.queryByText("Everything’s sent across these trips.")).not.toBeInTheDocument();
    expect(screen.getByText(/Saved trip .*Diver record 12345678/)).toBeInTheDocument();

    rendered.unmount();
    setOnline(false);
    render(<OfflineManifestView />);
    expect(
      await screen.findByText(/Older offline note text was removed after a data erasure/),
    ).toBeInTheDocument();
    expect(screen.queryByText("All up to date.")).not.toBeInTheDocument();
    expect(screen.queryByText("Everything’s sent across these trips.")).not.toBeInTheDocument();
  });

  it("keeps note loss ahead of all-up-to-date copy after a partial sync", async () => {
    const queued = envelope("trip-partial-loss", "Synthetic partial sync", {
      events: [
        {
          clientEventId: "pending-one",
          snapshotId: "snap-trip-partial-loss",
          snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
          tripId: "trip-partial-loss",
          bookingId: "booking-87654321",
          checkpoint: "departure",
          status: "boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    });
    const partiallySynced = envelope("trip-partial-loss", "Synthetic partial sync", {
      events: [
        {
          ...queued.events[0],
          syncStatus: "applied",
          note: null,
          noteDisposition: "discarded_erasure_cutoff",
        },
        {
          ...queued.events[0],
          clientEventId: "pending-two",
          note: null,
          syncStatus: "pending",
        },
      ],
    });
    vi.mocked(listOfflineManifests).mockResolvedValue([queued]);
    vi.mocked(syncOfflineManifest).mockResolvedValue(partiallySynced);

    render(<OfflineManifestView />);

    expect(
      await screen.findByText(/Older offline note text was removed after a data erasure/),
    ).toBeInTheDocument();
    expect(await screen.findByText("1 change is still sending.")).toBeInTheDocument();
    expect(screen.queryByText("All up to date.")).not.toBeInTheDocument();
    expect(screen.queryByText("Everything’s sent across these trips.")).not.toBeInTheDocument();
  });

  it("keeps the selected trip's own loss notice after verifying its shop", async () => {
    searchParams = new URLSearchParams({ trip: "trip-own-loss" });
    const saved = envelope("trip-own-loss", "Synthetic own-shop trip");
    saved.events = [
      {
        clientEventId: "own-loss-roll-call",
        snapshotId: "snap-trip-own-loss",
        snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
        tripId: "trip-own-loss",
        bookingId: "booking-12345678",
        checkpoint: "departure",
        status: "boarded",
        note: null,
        occurredAt: new Date(FROZEN_MS).toISOString(),
        syncStatus: "applied",
        noteDisposition: "discarded_erasure_cutoff",
      },
    ];
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);

    expect(
      await screen.findByText(/Older offline note text was removed after a data erasure/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Synthetic own-shop trip" })).toBeInTheDocument();
    expect(screen.getByText("Fresh roster · older notes removed")).toBeInTheDocument();
    expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  });
});

describe("OfflineManifestView — reporting roll call the ceiling threw away", () => {
  const discarded = [
    {
      tripId: "trip-9",
      tripTitle: "Morning Two-Tank",
      shopName: "Reef Runners",
      shopSlug: "blue-mantis",
      pendingEvents: 2,
      discardedAt: new Date(FROZEN_MS).toISOString(),
    },
  ];

  beforeEach(() => {
    vi.mocked(readDiscardedOfflineRecords).mockResolvedValue([]);
  });

  it("says what was lost, and for which trip, on the list branch", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([]);
    vi.mocked(readDiscardedOfflineRecords).mockResolvedValue(discarded);

    render(<OfflineManifestView />);

    expect(
      await screen.findByText("Roll call that never sent has been removed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reef Runners · Morning Two-Tank · 2 changes lost"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 roll-call changes/)).toBeInTheDocument();
  });

  it("says it on the single-trip branch too, wherever the captain happens to look", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope("trip-1", "Two-Tank Reef"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(readDiscardedOfflineRecords).mockResolvedValue(discarded);

    render(<OfflineManifestView />);

    expect(
      await screen.findByText("Roll call that never sent has been removed"),
    ).toBeInTheDocument();
  });

  it("stays put until a human acknowledges it", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([]);
    vi.mocked(readDiscardedOfflineRecords).mockResolvedValue(discarded);

    render(<OfflineManifestView />);
    const notice = await screen.findByText("Roll call that never sent has been removed");
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(notice).toBeInTheDocument();

    screen.getByRole("button", { name: "Got it" }).click();

    await waitFor(() => expect(acknowledgeDiscardedOfflineRecords).toHaveBeenCalled());
    expect(
      screen.queryByText("Roll call that never sent has been removed"),
    ).not.toBeInTheDocument();
  });

  it("says nothing when nothing has been thrown away", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);

    render(<OfflineManifestView />);

    await screen.findByText("Two-Tank Reef");
    expect(
      screen.queryByText("Roll call that never sent has been removed"),
    ).not.toBeInTheDocument();
  });
});
