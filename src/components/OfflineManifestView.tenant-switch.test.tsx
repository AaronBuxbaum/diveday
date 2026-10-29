// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  listOfflineManifests,
  loadOfflineManifest,
  OfflineManifestError,
  purgeOfflineManifestsExceptShop,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { OfflineManifestView } from "./OfflineManifestView";
import {
  envelope,
  FROZEN_MS,
  identityResponse,
  richEnvelope,
  setOnline,
} from "./offline-manifest/view-fixtures";

let searchParams = new URLSearchParams("trip=trip-1");
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/lib/offline-manifest-store", async () => ({
  OfflineManifestError: (
    await vi.importActual<typeof import("@/lib/offline-manifest-store")>(
      "@/lib/offline-manifest-store",
    )
  ).OfflineManifestError,
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
  loadOfflineManifest: vi.fn(),
  listOfflineManifests: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue([]),
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  syncOfflineManifest: vi.fn(),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
}));

beforeEach(() => {
  searchParams = new URLSearchParams("trip=trip-1");
  setOnline(true);
  vi.mocked(loadOfflineManifest).mockReset();
  vi.mocked(listOfflineManifests).mockReset();
  vi.mocked(listOfflineManifests).mockResolvedValue([]);
  vi.mocked(purgeOfflineManifestsExceptShop).mockClear();
  vi.mocked(syncOfflineManifest).mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

function savedWithDiscardedNote(tripId: string) {
  const saved = richEnvelope(tripId);
  saved.events = [
    {
      clientEventId: `discarded-note-${tripId}`,
      snapshotId: saved.snapshot.snapshotId,
      snapshotSavedAt: saved.snapshot.savedAt,
      tripId,
      bookingId: "booking-12345678",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: new Date(FROZEN_MS).toISOString(),
      note: null,
      syncStatus: "applied",
      noteDisposition: "discarded_erasure_cutoff",
    },
  ];
  return saved;
}

it("quarantines the root list as soon as one trip detects a shop switch", async () => {
  searchParams = new URLSearchParams();
  const first = richEnvelope("trip-1");
  const second = richEnvelope("trip-2");
  for (const saved of [first, second]) {
    const tripId = saved.snapshot.manifests[0]?.trip.id;
    expect(tripId).toBeDefined();
    saved.events.push({
      clientEventId: `event-${tripId}`,
      snapshotId: saved.snapshot.snapshotId,
      snapshotSavedAt: saved.snapshot.savedAt,
      tripId: tripId ?? "missing-trip",
      bookingId: "synthetic-booking",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: new Date(FROZEN_MS).toISOString(),
      note: null,
      syncStatus: "pending",
    });
  }
  vi.mocked(listOfflineManifests).mockResolvedValue([first, second]);

  let rejectFirst: (error: Error) => void = () => {};
  let resolveSecond: (envelope: OfflineManifestEnvelope | null) => void = () => {};
  vi.mocked(syncOfflineManifest).mockImplementation((tripId) =>
    tripId === "trip-1"
      ? new Promise((_, reject) => {
          rejectFirst = reject;
        })
      : new Promise((resolve) => {
          resolveSecond = resolve;
        }),
  );
  let mismatch = false;
  let allowShopB = false;
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) !== "/api/offline-manifests/identity") return new Response(null);
    if (!mismatch) return identityResponse("blue-mantis");
    if (!allowShopB) throw new Error("identity lookup unavailable");
    return identityResponse("reef-runners");
  });

  render(<OfflineManifestView />);
  await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Saved/)).toBeInTheDocument();

  mismatch = true;
  await act(async () => rejectFirst(new OfflineManifestError("shop_changed")));
  expect(
    await screen.findByRole("heading", { name: "Checking this device’s shop" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(first.events[0]?.syncStatus).toBe("pending");
  expect(second.events[0]?.syncStatus).toBe("pending");

  // The second trip has not completed; its late response must not repaint the
  // Shop A list or settle its retained pending event.
  await act(async () => resolveSecond(null));
  expect(screen.getByRole("heading", { name: "Checking this device’s shop" })).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(first.events[0]?.syncStatus).toBe("pending");
  expect(second.events[0]?.syncStatus).toBe("pending");
  allowShopB = true;
});

it("shows a tenant-neutral recovery notice for a verified shop with foreign pending events", async () => {
  searchParams = new URLSearchParams();
  const foreign = richEnvelope("foreign-trip-31");
  foreign.events.push({
    clientEventId: "foreign-pending-event",
    snapshotId: foreign.snapshot.snapshotId,
    snapshotSavedAt: foreign.snapshot.savedAt,
    tripId: "foreign-trip-31",
    bookingId: "sensitive-person-31",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: new Date(FROZEN_MS).toISOString(),
    note: "Sensitive erased note text",
    syncStatus: "pending",
  });
  vi.mocked(listOfflineManifests).mockResolvedValue([foreign]);
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("reef-runners")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  expect(
    await screen.findByRole("heading", { name: "No saved manifest on this phone" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Pending changes for another shop remain on this device. Sign in to that shop to sync or review them.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(
      /Blue Mantis|Two-Tank Reef|foreign-trip-31|sensitive-person-31|Sensitive erased note text/,
    ),
  ).not.toBeInTheDocument();
  expect(foreign.events[0]?.syncStatus).toBe("pending");
  expect(foreign.events[0]?.note).toBe("Sensitive erased note text");
});

it("keeps the recovery notice and suppresses caught-up copy after current-shop sync", async () => {
  searchParams = new URLSearchParams();
  const foreign = envelope("foreign-trip-33", "Private A departure", {
    shopSlug: "blue-mantis",
    shopName: "Blue Mantis Divers",
  });
  const current = envelope("current-trip-34", "B morning", {
    shopSlug: "reef-runners",
    shopName: "Reef Runners",
  });
  const addPendingEvent = (saved: OfflineManifestEnvelope, id: string) => {
    saved.events.push({
      clientEventId: id,
      snapshotId: saved.snapshot.snapshotId,
      snapshotSavedAt: saved.snapshot.savedAt,
      tripId: saved.snapshot.manifests[0]?.trip.id ?? "missing-trip",
      bookingId: "sensitive-person",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: new Date(FROZEN_MS).toISOString(),
      note: "Private note text",
      syncStatus: "pending",
    });
  };
  addPendingEvent(foreign, "foreign-pending-event");
  addPendingEvent(current, "current-pending-event");
  vi.mocked(listOfflineManifests).mockResolvedValue([foreign, current]);
  vi.mocked(syncOfflineManifest).mockResolvedValue({ ...current, events: [] });
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("reef-runners")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  expect(await screen.findByRole("heading", { name: "Saved on this device" })).toBeInTheDocument();
  expect(
    await screen.findByText(
      "Pending changes for another shop remain on this device. Sign in to that shop to sync or review them.",
    ),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(syncOfflineManifest).toHaveBeenCalledWith("current-trip-34", "reef-runners", 1),
  );
  expect(screen.queryByText("Everything’s sent across these trips.")).not.toBeInTheDocument();
  expect(screen.queryByText("All up to date.")).not.toBeInTheDocument();
  expect(screen.queryByText("Private A departure")).not.toBeInTheDocument();
  expect(screen.queryByText("Blue Mantis Divers")).not.toBeInTheDocument();
  expect(screen.queryByText("sensitive-person")).not.toBeInTheDocument();
  expect(screen.queryByText("Private note text")).not.toBeInTheDocument();
});

it("shows the tenant-neutral recovery notice on a selected trip after shop verification", async () => {
  searchParams = new URLSearchParams({ trip: "trip-b-44" });
  const foreign = envelope("foreign-trip-44", "Private A departure", {
    shopSlug: "blue-mantis",
    shopName: "Blue Mantis Divers",
  });
  foreign.events.push({
    clientEventId: "foreign-pending-event",
    snapshotId: foreign.snapshot.snapshotId,
    snapshotSavedAt: foreign.snapshot.savedAt,
    tripId: "foreign-trip-44",
    bookingId: "private-person-44",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: new Date(FROZEN_MS).toISOString(),
    note: "Private note text",
    syncStatus: "pending",
  });
  const selected = richEnvelope("trip-b-44");
  selected.snapshot.shop = {
    ...selected.snapshot.shop,
    slug: "reef-runners",
    name: "Reef Runners",
  };
  vi.mocked(loadOfflineManifest).mockResolvedValue(selected);
  vi.mocked(listOfflineManifests).mockResolvedValue([foreign, selected]);
  let resolveTripSync: (saved: OfflineManifestEnvelope | null) => void = () => {};
  vi.mocked(syncOfflineManifest).mockReturnValue(
    new Promise((resolve) => {
      resolveTripSync = resolve;
    }),
  );
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("reef-runners")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  expect(await screen.findByRole("heading", { name: "Two-Tank Reef" })).toBeInTheDocument();
  expect(
    await screen.findByText(
      "Pending changes for another shop remain on this device. Sign in to that shop to sync or review them.",
    ),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(syncOfflineManifest).toHaveBeenCalledWith("trip-b-44", "reef-runners", 1),
  );
  await act(async () => resolveTripSync({ ...selected, events: [] }));
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(screen.queryByText("Private A departure")).not.toBeInTheDocument();
  expect(screen.queryByText("Blue Mantis Divers")).not.toBeInTheDocument();
  expect(screen.queryByText("foreign-trip-44")).not.toBeInTheDocument();
  expect(screen.queryByText("private-person-44")).not.toBeInTheDocument();
  expect(screen.queryByText("Private note text")).not.toBeInTheDocument();
  expect(foreign.events[0]?.syncStatus).toBe("pending");
});

it("shows tenant-neutral recovery guidance instead of a foreign trip's identifiers", async () => {
  searchParams = new URLSearchParams({ trip: "foreign-trip-45a" });
  const foreign = envelope("foreign-trip-45a", "Private A departure", {
    shopSlug: "blue-mantis",
    shopName: "Blue Mantis Divers",
  });
  foreign.events.push({
    clientEventId: "foreign-pending-event-45a",
    snapshotId: foreign.snapshot.snapshotId,
    snapshotSavedAt: foreign.snapshot.savedAt,
    tripId: "foreign-trip-45a",
    bookingId: "private-person-45a",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: new Date(FROZEN_MS).toISOString(),
    note: "Private note text",
    syncStatus: "pending",
  });
  vi.mocked(loadOfflineManifest).mockResolvedValue(foreign);
  vi.mocked(listOfflineManifests).mockResolvedValue([foreign]);
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("reef-runners")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  expect(
    await screen.findByRole("heading", { name: "This trip isn’t available here" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(
      "Pending changes for another shop remain on this device. Sign in to that shop to sync or review them.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private A departure")).not.toBeInTheDocument();
  expect(screen.queryByText("Blue Mantis Divers")).not.toBeInTheDocument();
  expect(screen.queryByText("foreign-trip-45a")).not.toBeInTheDocument();
  expect(screen.queryByText("private-person-45a")).not.toBeInTheDocument();
  expect(screen.queryByText("Private note text")).not.toBeInTheDocument();
  expect(foreign.events[0]?.syncStatus).toBe("pending");
});

it("clears caught-up copy while reconnect waits for fresh tenant verification", async () => {
  searchParams = new URLSearchParams({ trip: "trip-reconnect-51" });
  const initial = richEnvelope("trip-reconnect-51");
  const firstSuccess = { ...initial, events: [] };
  const pendingMark = {
    clientEventId: "cross-tab-pending-51",
    snapshotId: initial.snapshot.snapshotId,
    snapshotSavedAt: initial.snapshot.savedAt,
    tripId: "trip-reconnect-51",
    bookingId: "booking-12345678",
    checkpoint: "departure" as const,
    status: "boarded" as const,
    occurredAt: new Date(FROZEN_MS).toISOString(),
    note: null,
    syncStatus: "pending" as const,
  };
  const afterCrossTabSync = {
    ...initial,
    events: [{ ...pendingMark, syncStatus: "applied" as const }],
  };
  vi.mocked(loadOfflineManifest).mockResolvedValue(initial);
  vi.mocked(listOfflineManifests).mockResolvedValue([firstSuccess]);
  vi.mocked(syncOfflineManifest).mockResolvedValue(firstSuccess);
  let deferNextIdentity = false;
  let resolveDeferredIdentity: ((response: Response) => void) | null = null;
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) !== "/api/offline-manifests/identity")
      return new Response(null, { status: 200 });
    if (deferNextIdentity) {
      deferNextIdentity = false;
      return new Promise<Response>((resolve) => {
        resolveDeferredIdentity = resolve;
      });
    }
    return identityResponse("blue-mantis");
  });

  render(<OfflineManifestView />);
  expect(await screen.findByRole("heading", { name: "Two-Tank Reef" })).toBeInTheDocument();
  expect(await screen.findByText("Everything’s sent.")).toBeInTheDocument();
  await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalled());

  // Another tab writes after the success; reconnect now needs a fresh identity.
  vi.mocked(loadOfflineManifest).mockResolvedValue({ ...initial, events: [pendingMark] });
  vi.mocked(listOfflineManifests).mockResolvedValue([{ ...initial, events: [pendingMark] }]);
  vi.mocked(syncOfflineManifest).mockResolvedValue(afterCrossTabSync);
  const callsBeforeReconnect = vi.mocked(syncOfflineManifest).mock.calls.length;
  deferNextIdentity = true;
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(resolveDeferredIdentity).not.toBeNull());

  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(vi.mocked(syncOfflineManifest).mock.calls.length).toBe(callsBeforeReconnect);

  await act(async () => resolveDeferredIdentity?.(identityResponse("blue-mantis")));
  await waitFor(() =>
    expect(vi.mocked(syncOfflineManifest).mock.calls.length).toBeGreaterThan(callsBeforeReconnect),
  );
  expect(vi.mocked(syncOfflineManifest)).toHaveBeenCalledWith(
    "trip-reconnect-51",
    "blue-mantis",
    1,
  );
  expect(pendingMark.syncStatus).toBe("pending");
});

it("withholds selected-trip caught-up copy until the tenant-scoped inventory settles", async () => {
  searchParams = new URLSearchParams({ trip: "trip-b-45" });
  const foreign = envelope("foreign-trip-45", "Private A departure", {
    shopSlug: "blue-mantis",
    shopName: "Blue Mantis Divers",
  });
  foreign.events.push({
    clientEventId: "foreign-pending-event-45",
    snapshotId: foreign.snapshot.snapshotId,
    snapshotSavedAt: foreign.snapshot.savedAt,
    tripId: "foreign-trip-45",
    bookingId: "private-person-45",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: new Date(FROZEN_MS).toISOString(),
    note: "Private note text",
    syncStatus: "pending",
  });
  const selected = richEnvelope("trip-b-45");
  selected.snapshot.shop = {
    ...selected.snapshot.shop,
    slug: "reef-runners",
    name: "Reef Runners",
  };
  vi.mocked(loadOfflineManifest).mockResolvedValue(selected);
  let resolveInventory: (saved: OfflineManifestEnvelope[]) => void = () => {};
  vi.mocked(listOfflineManifests).mockReturnValue(
    new Promise((resolve) => {
      resolveInventory = resolve;
    }),
  );
  vi.mocked(syncOfflineManifest).mockResolvedValue({ ...selected, events: [] });
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("reef-runners")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  await waitFor(() =>
    expect(syncOfflineManifest).toHaveBeenCalledWith("trip-b-45", "reef-runners", 1),
  );
  await waitFor(() => expect(syncOfflineManifest).toHaveResolved());
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();

  await act(async () => resolveInventory([foreign, selected]));
  expect(
    await screen.findByText(
      "Pending changes for another shop remain on this device. Sign in to that shop to sync or review them.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(screen.queryByText("Private A departure")).not.toBeInTheDocument();
  expect(screen.queryByText("Blue Mantis Divers")).not.toBeInTheDocument();
  expect(screen.queryByText("foreign-trip-45")).not.toBeInTheDocument();
  expect(screen.queryByText("private-person-45")).not.toBeInTheDocument();
  expect(screen.queryByText("Private note text")).not.toBeInTheDocument();
  expect(foreign.events[0]?.syncStatus).toBe("pending");
});

it("keeps caught-up copy suppressed when the selected-trip inventory read fails", async () => {
  searchParams = new URLSearchParams({ trip: "trip-b-46" });
  const selected = richEnvelope("trip-b-46");
  selected.snapshot.shop = {
    ...selected.snapshot.shop,
    slug: "reef-runners",
    name: "Reef Runners",
  };
  vi.mocked(loadOfflineManifest).mockResolvedValue(selected);
  vi.mocked(listOfflineManifests).mockRejectedValue(new Error("storage unavailable"));
  vi.mocked(syncOfflineManifest).mockResolvedValue({ ...selected, events: [] });
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("reef-runners")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  await waitFor(() =>
    expect(syncOfflineManifest).toHaveBeenCalledWith("trip-b-46", "reef-runners", 1),
  );
  await waitFor(() => expect(syncOfflineManifest).toHaveResolved());
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
});

it("ignores an older inventory refresh that resolves after the newer tenant-scoped read", async () => {
  searchParams = new URLSearchParams({ trip: "trip-b-47" });
  const foreign = envelope("foreign-trip-47", "Private A departure", {
    shopSlug: "blue-mantis",
    shopName: "Blue Mantis Divers",
  });
  foreign.events.push({
    clientEventId: "foreign-pending-event-47",
    snapshotId: foreign.snapshot.snapshotId,
    snapshotSavedAt: foreign.snapshot.savedAt,
    tripId: "foreign-trip-47",
    bookingId: "private-person-47",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: new Date(FROZEN_MS).toISOString(),
    note: "Private note text",
    syncStatus: "pending",
  });
  const selected = richEnvelope("trip-b-47");
  selected.snapshot.shop = {
    ...selected.snapshot.shop,
    slug: "reef-runners",
    name: "Reef Runners",
  };
  vi.mocked(loadOfflineManifest).mockResolvedValue(selected);
  const inventoryReads: Array<(saved: OfflineManifestEnvelope[]) => void> = [];
  vi.mocked(listOfflineManifests).mockImplementation(
    () => new Promise((resolve) => inventoryReads.push(resolve)),
  );
  vi.mocked(syncOfflineManifest).mockResolvedValue({ ...selected, events: [] });
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("reef-runners")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);
  await waitFor(() => expect(inventoryReads).toHaveLength(1));
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(inventoryReads.length).toBeGreaterThanOrEqual(2));

  const newestRead = inventoryReads.at(-1);
  await act(async () => newestRead?.([foreign, selected]));
  expect(
    await screen.findByText(
      "Pending changes for another shop remain on this device. Sign in to that shop to sync or review them.",
    ),
  ).toBeInTheDocument();
  await act(async () => inventoryReads[0]?.([selected]));

  expect(
    screen.getByText(
      "Pending changes for another shop remain on this device. Sign in to that shop to sync or review them.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(screen.queryByText("Private A departure")).not.toBeInTheDocument();
  expect(screen.queryByText("Blue Mantis Divers")).not.toBeInTheDocument();
  expect(screen.queryByText("foreign-trip-47")).not.toBeInTheDocument();
  expect(screen.queryByText("private-person-47")).not.toBeInTheDocument();
  expect(screen.queryByText("Private note text")).not.toBeInTheDocument();
  expect(foreign.events[0]?.syncStatus).toBe("pending");
});

it("keeps the sync disposition when a pre-sync inventory read resolves late", async () => {
  searchParams = new URLSearchParams({ trip: "trip-loss-48" });
  const savedBeforeSync = richEnvelope("trip-loss-48");
  const oldNote = {
    clientEventId: "loss-event-48",
    snapshotId: savedBeforeSync.snapshot.snapshotId,
    snapshotSavedAt: savedBeforeSync.snapshot.savedAt,
    tripId: "trip-loss-48",
    bookingId: "booking-12345678",
    checkpoint: "departure" as const,
    status: "boarded" as const,
    note: "Sensitive note text",
    occurredAt: new Date(FROZEN_MS).toISOString(),
    syncStatus: "pending" as const,
  };
  savedBeforeSync.events = [oldNote];
  const syncedWithLoss = {
    ...savedBeforeSync,
    events: [
      {
        ...oldNote,
        note: null,
        syncStatus: "applied" as const,
        noteDisposition: "discarded_erasure_cutoff" as const,
      },
    ],
  };
  vi.mocked(loadOfflineManifest).mockResolvedValue(savedBeforeSync);
  let resolveCapturedInventory: (saved: OfflineManifestEnvelope[]) => void = () => {};
  vi.mocked(listOfflineManifests).mockReturnValue(
    new Promise((resolve) => {
      resolveCapturedInventory = resolve;
    }),
  );
  vi.mocked(syncOfflineManifest).mockResolvedValue(syncedWithLoss);
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("blue-mantis")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  expect(
    await screen.findByText(/Older offline note text was removed after a data erasure/),
  ).toBeInTheDocument();
  expect(await screen.findByText(/Diver record 12345678.*mark kept/)).toBeInTheDocument();
  expect(screen.queryByText("Sensitive note text")).not.toBeInTheDocument();
  expect(syncedWithLoss.events[0]?.note).toBeNull();
  expect(syncedWithLoss.events[0]?.occurredAt).toBe(oldNote.occurredAt);
  expect(syncedWithLoss.events[0]?.status).toBe("boarded");

  await act(async () => resolveCapturedInventory([savedBeforeSync]));

  expect(
    screen.getByText(/Older offline note text was removed after a data erasure/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Diver record 12345678.*mark kept/)).toBeInTheDocument();
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(screen.queryByText("Sensitive note text")).not.toBeInTheDocument();
});

it("keeps the actionable note-loss notice beside retry feedback when identity lookup fails", async () => {
  searchParams = new URLSearchParams({ trip: "trip-loss-identity-52" });
  const saved = savedWithDiscardedNote("trip-loss-identity-52");
  vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) === "/api/offline-manifests/identity") {
      throw new Error("identity lookup unavailable");
    }
    return new Response(null, { status: 200 });
  });

  render(<OfflineManifestView />);

  expect(await screen.findByText(/Couldn’t reach DiveDay just now/)).toBeInTheDocument();
  expect(
    await screen.findByText(/Each line is a separate mark whose older offline note was removed/),
  ).toBeInTheDocument();
  expect(await screen.findByText(/Diver record 12345678.*mark kept/)).toBeInTheDocument();
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(screen.queryByText(/Sensitive note text/)).not.toBeInTheDocument();
  expect(saved.events[0]).toMatchObject({
    syncStatus: "applied",
    note: null,
    noteDisposition: "discarded_erasure_cutoff",
  });
  expect(syncOfflineManifest).not.toHaveBeenCalled();
});

it("keeps the actionable note-loss notice beside retry feedback when sync fails", async () => {
  searchParams = new URLSearchParams({ trip: "trip-loss-sync-53" });
  const saved = savedWithDiscardedNote("trip-loss-sync-53");
  vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
  vi.mocked(syncOfflineManifest).mockRejectedValue(new Error("temporary sync failure"));
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("blue-mantis")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);

  expect(await screen.findByText(/Couldn’t reach DiveDay just now/)).toBeInTheDocument();
  expect(
    await screen.findByText(/Older offline note text was removed after a data erasure/),
  ).toBeInTheDocument();
  expect(await screen.findByText(/Diver record 12345678.*mark kept/)).toBeInTheDocument();
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(screen.queryByText(/Sensitive note text/)).not.toBeInTheDocument();
  expect(saved.events[0]).toMatchObject({
    syncStatus: "applied",
    note: null,
    noteDisposition: "discarded_erasure_cutoff",
  });
});

it("keeps a newer sync failure authoritative over inventory captured before it", async () => {
  searchParams = new URLSearchParams({ trip: "trip-retry-49" });
  const saved = richEnvelope("trip-retry-49");
  saved.events.push({
    clientEventId: "retry-event-49",
    snapshotId: saved.snapshot.snapshotId,
    snapshotSavedAt: saved.snapshot.savedAt,
    tripId: "trip-retry-49",
    bookingId: "booking-12345678",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: new Date(FROZEN_MS).toISOString(),
    note: null,
    syncStatus: "pending",
  });
  const event = saved.events[0];
  if (!event) throw new Error("Expected a pending roll-call event");
  const firstSuccess = { ...saved, events: [{ ...event, syncStatus: "applied" as const }] };
  vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
  const inventoryReads: Array<(saved: OfflineManifestEnvelope[]) => void> = [];
  vi.mocked(listOfflineManifests).mockReturnValue(
    new Promise((resolve) => {
      inventoryReads.push(resolve);
    }),
  );
  vi.mocked(syncOfflineManifest)
    .mockResolvedValueOnce(firstSuccess)
    .mockRejectedValue(new Error("temporary network failure"));
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input) === "/api/offline-manifests/identity"
      ? identityResponse("blue-mantis")
      : new Response(null, { status: 200 }),
  );

  render(<OfflineManifestView />);
  await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(inventoryReads.length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(syncOfflineManifest).toHaveBeenNthCalledWith(1, "trip-retry-49", "blue-mantis", 1),
  );

  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(vi.mocked(syncOfflineManifest).mock.calls.length).toBeGreaterThan(1));
  expect(await screen.findByText(/Couldn’t reach DiveDay just now/)).toBeInTheDocument();

  // This inventory was captured before either sync and still says pending.
  // It is evidence for foreign pending work, not the selected trip's outcome.
  await act(async () => inventoryReads[0]?.([saved]));

  expect(screen.getByText(/Couldn’t reach DiveDay just now/)).toBeInTheDocument();
  expect(screen.queryByText("All up to date.")).not.toBeInTheDocument();
  expect(screen.queryByText("Everything’s sent.")).not.toBeInTheDocument();
  expect(saved.events[0]?.syncStatus).toBe("pending");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("quarantines a selected roster through failed verification, then scopes it after Shop B verifies", async () => {
  const saved = richEnvelope(
    "trip-1",
    {},
    {
      events: [
        {
          clientEventId: "synthetic-event",
          snapshotId: "snap-trip-1",
          snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
          tripId: "trip-1",
          bookingId: "synthetic-booking",
          checkpoint: "departure",
          status: "boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          note: null,
          syncStatus: "pending",
        } as OfflineManifestEnvelope["events"][number],
      ],
    },
  );
  vi.mocked(loadOfflineManifest).mockResolvedValue(saved);

  let rejectSync: (error: Error) => void = () => {};
  vi.mocked(syncOfflineManifest).mockReturnValue(
    new Promise((_, reject) => {
      rejectSync = reject;
    }),
  );
  let mismatch = false;
  let allowShopB = false;
  let deferNextIdentity = false;
  let resolveDeferredIdentity: ((response: Response) => void) | null = null;
  let identityLookups = 0;
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) !== "/api/offline-manifests/identity") {
      return new Response(null, { status: 200 });
    }
    identityLookups += 1;
    if (!mismatch) return identityResponse("blue-mantis");
    if (deferNextIdentity) {
      deferNextIdentity = false;
      return new Promise<Response>((resolve) => {
        resolveDeferredIdentity = resolve;
      });
    }
    if (!allowShopB) throw new Error("identity lookup unavailable");
    return identityResponse("reef-runners");
  });

  render(<OfflineManifestView />);
  expect(await screen.findByText("Dana Divemaster")).toBeInTheDocument();
  await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledWith("trip-1", "blue-mantis", 1));

  const lookupsBeforeMismatch = identityLookups;
  mismatch = true;
  deferNextIdentity = true;
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(identityLookups).toBeGreaterThan(lookupsBeforeMismatch));
  await waitFor(() => expect(resolveDeferredIdentity).not.toBeNull());
  await act(async () => rejectSync(new OfflineManifestError("shop_changed")));
  expect(
    await screen.findByRole("heading", { name: "Checking this device’s shop" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /board/i })).not.toBeInTheDocument();
  expect(screen.getByRole("status").textContent).toContain("Pending changes remain saved");
  expect(saved.events[0]?.syncStatus).toBe("pending");

  // The pre-mismatch lookup resolves with stale Shop A after invalidation; it
  // must not cache A or release quarantine. A failed fresh lookup stays hidden.
  await act(async () => resolveDeferredIdentity?.(identityResponse("blue-mantis")));
  expect(screen.getByRole("heading", { name: "Checking this device’s shop" })).toBeInTheDocument();
  allowShopB = true;
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() =>
    expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith(
      "reef-runners",
      1,
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    ),
  );
  expect(
    await screen.findByRole("heading", { name: "This trip isn’t available here" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(syncOfflineManifest).toHaveBeenCalledTimes(1);
  expect(saved.events[0]?.syncStatus).toBe("pending");
  expect(readDiscardedOfflineRecords).toHaveBeenCalled();
});
