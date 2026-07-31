// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendOfflineRollCall,
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

type DiverFixture = OfflineManifestPayload["manifests"][number]["divers"][number];

/**
 * A payload with a real roster (unlike `payload()` above, whose `divers: []`
 * suits the list-mode tests but can't exercise roll-call rendering) across
 * "departure" and "after_dive_1" — for the dive-domain-expert invariants on
 * task 72 (docs/product/archive/ux-personas-20260730-findings.md, persona 10 Sal).
 */
function richPayload(
  tripId: string,
  opts: {
    readiness?: "ready" | "blocked";
    /** Second diver, present at departure and carried not-boarded after dive 1. */
    withCarriedNotBoarded?: boolean;
  } = {},
): OfflineManifestPayload {
  const trip = {
    id: tripId,
    title: "Two-Tank Reef",
    startsAt: "2026-08-01T13:00:00.000Z",
    endsAt: "2026-08-01T16:30:00.000Z",
    plannedDives: 1,
  };
  const priya: DiverFixture = {
    bookingId: "diver-priya",
    fullName: "Priya Shah",
    email: null,
    emergencyContactName: "Anil Shah",
    emergencyContactPhone: "+1-305-555-0177",
    readiness: { status: opts.readiness ?? "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    rollCall: undefined,
  };
  const carried: DiverFixture = {
    bookingId: "diver-marcus",
    fullName: "Marcus Reed",
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    rollCall: undefined,
  };
  const carriedAfterDive: DiverFixture = {
    ...carried,
    rollCall: {
      state: "not_boarded",
      occurredAt: "2026-08-01T13:05:00.000Z",
      recordedByName: "Dana Divemaster",
      note: "Left after departure",
      implied: true,
    },
  };
  const divers = opts.withCarriedNotBoarded ? [priya, carried] : [priya];
  const diversAfterDive = opts.withCarriedNotBoarded ? [priya, carriedAfterDive] : [priya];
  return {
    shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
    manifests: [
      {
        trip,
        checkpoint: "departure",
        crew: [],
        divers,
        summary: {
          totalDivers: divers.length,
          ready: divers.filter((d) => d.readiness.status === "ready").length,
          blocked: divers.filter((d) => d.readiness.status === "blocked").length,
          boarded: 0,
          notBoarded: 0,
          awaiting: divers.length,
        },
      },
      {
        trip,
        checkpoint: "after_dive_1",
        crew: [],
        divers: diversAfterDive,
        summary: {
          totalDivers: diversAfterDive.length,
          ready: diversAfterDive.filter((d) => d.readiness.status === "ready").length,
          blocked: diversAfterDive.filter((d) => d.readiness.status === "blocked").length,
          boarded: 0,
          notBoarded: opts.withCarriedNotBoarded ? 1 : 0,
          awaiting: opts.withCarriedNotBoarded
            ? diversAfterDive.length - 1
            : diversAfterDive.length,
        },
      },
    ],
  };
}

function richEnvelope(
  tripId: string,
  opts: Parameters<typeof richPayload>[1] = {},
  envOpts: { events?: OfflineManifestEnvelope["events"]; expiresAt?: string } = {},
): OfflineManifestEnvelope {
  const base = richPayload(tripId, opts);
  return {
    snapshot: {
      ...base,
      version: 4,
      snapshotId: `snap-${tripId}`,
      savedAt: new Date(FROZEN_MS).toISOString(),
      expiresAt: envOpts.expiresAt ?? new Date(FROZEN_MS + 1_000_000).toISOString(),
    },
    events: envOpts.events ?? [],
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

// Task 72 — dive-domain-expert review invariants (persona 10 Sal,
// docs/product/archive/ux-personas-20260730-findings.md), exercised at the UI
// level. The pure-function guarantees these depend on are covered directly
// in src/lib/offline-manifests.test.ts and src/lib/offline-manifest-store.test.ts;
// these confirm the ported UI honors them rather than adding its own gate.
describe("OfflineManifestView — ported boat affordances (task 72)", () => {
  beforeEach(() => {
    vi.stubGlobal("vibrate", undefined);
    Object.defineProperty(navigator, "vibrate", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it("invariant 1: hides Board for a not-ready diver at departure but shows it after a numbered dive", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    // Departure: no Board button for the blocked diver, only Not boarded.
    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark not boarded" })).toBeInTheDocument();

    // Switch to the after-dive-1 checkpoint — a pure headcount now.
    fireEvent.click(screen.getByRole("button", { name: "After dive 1" }));
    expect(await screen.findByRole("button", { name: "Mark boarded" })).toBeInTheDocument();
  });

  it("invariant 2: recording boarded after a numbered dive for a not-ready diver succeeds as a pure headcount", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { readiness: "blocked" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    const afterBoard: OfflineManifestEnvelope = {
      ...saved,
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: saved.snapshot.snapshotId,
          snapshotSavedAt: saved.snapshot.savedAt,
          tripId: "trip-1",
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "boarded",
          note: null,
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    };
    vi.mocked(appendOfflineRollCall).mockResolvedValue(afterBoard);

    render(<OfflineManifestView />);
    const boardButton = await screen.findByRole("button", { name: "Mark boarded" });
    fireEvent.click(boardButton);

    await waitFor(() =>
      expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
        bookingId: "diver-priya",
        checkpoint: "after_dive_1",
        status: "boarded",
        note: null,
      }),
    );
    // No refusal message — the tap actually recorded, matching what the
    // visible "Board" button implied it would do.
    expect(screen.getByText(/Saved on this phone/)).toBeInTheDocument();
    expect(screen.queryByText(/does not allow boarding/)).not.toBeInTheDocument();
  });

  it("invariant 3: an expired copy shows no board/not-board buttons, a distinct message, and never fires a haptic or the celebration", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    const expired = richEnvelope(
      "trip-1",
      {},
      { expiresAt: new Date(FROZEN_MS - 1000).toISOString() },
    );
    vi.mocked(loadOfflineManifest).mockResolvedValue(expired);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark not boarded" })).not.toBeInTheDocument();
    // The distinct expired banner and the per-diver "record on the live
    // manifest" copy — not the generic freshness banner every other stale
    // copy shows.
    expect(
      screen.getByText(/This saved copy has expired and can't be used to board divers/),
    ).toBeInTheDocument();
    expect(screen.getByText("Expired — record on the live manifest")).toBeInTheDocument();
    expect(appendOfflineRollCall).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sub-surface-ripple")).not.toBeInTheDocument();
  });

  it("invariant 4: a live transition to awaiting===0 via carried-forward not-boarded (nobody actually boarded) never celebrates", async () => {
    // SubSurfaceRipple only ever fires on a false→true *transition* of its
    // `complete` prop (see its own component) — a manifest that is already
    // "complete" on the very first render can never exercise the gate this
    // test is for, so this drives a real transition: mount not-complete
    // (Priya still awaiting), then record Priya as *not boarded* too. Both
    // divers now have a result (awaiting hits zero — Marcus was already
    // carried not-boarded from departure) but *nobody* is aboard. If the
    // celebration were gated on `rollCallComplete` (awaiting === 0) instead
    // of the true boarded count, this transition would incorrectly fire it.
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { withCarriedNotBoarded: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    const afterNotBoard: OfflineManifestEnvelope = {
      ...saved,
      events: [
        {
          clientEventId: "evt-1",
          snapshotId: saved.snapshot.snapshotId,
          snapshotSavedAt: saved.snapshot.savedAt,
          tripId: "trip-1",
          bookingId: "diver-priya",
          checkpoint: "after_dive_1",
          status: "not_boarded",
          note: null,
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    };
    vi.mocked(appendOfflineRollCall).mockResolvedValue(afterNotBoard);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // Not complete yet — Priya is still awaiting.
    expect(screen.queryByTestId("sub-surface-ripple")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark not boarded" }));
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    // Roll call now reads complete (both divers have a result) — the
    // existing "someNotBoarded" wording says so correctly, never "everyone's
    // aboard".
    expect(await screen.findByText(/Roll call complete/)).toBeInTheDocument();
    expect(screen.getByText(/marked not boarded/)).toBeInTheDocument();
    expect(screen.queryByText(/everyone's aboard/)).not.toBeInTheDocument();

    // SubSurfaceRipple mounts the celebration markup one render *after* its
    // `complete` prop flips (its own `useEffect` calls `setActive(true)`,
    // scheduling a second commit) — flush past that window with a real timer
    // tick before asserting absence, so this doesn't just win a race against
    // an effect that hasn't run yet.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByTestId("sub-surface-ripple")).not.toBeInTheDocument();
    // MilestoneHaptics is keyed off the true boarded count too (0 of 2) —
    // no 100%-milestone vibration for a roll call where nobody boarded.
    expect(navigator.vibrate).not.toHaveBeenCalledWith([100, 50, 100, 50, 200]);
  });

  it("invariant 5: pending/rejected sync counts stay visible even once local roll call reads complete", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    const saved = richEnvelope(
      "trip-1",
      {},
      {
        events: [
          {
            clientEventId: "evt-1",
            snapshotId: "snap-trip-1",
            snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
            tripId: "trip-1",
            bookingId: "diver-priya",
            checkpoint: "departure",
            status: "boarded",
            note: null,
            occurredAt: new Date(FROZEN_MS).toISOString(),
            syncStatus: "pending",
          },
        ],
      },
    );
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(saved); // still pending after "reconcile"

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    // The board is locally complete (Priya boarded, nobody else on this
    // roster) — the celebration/ripple gate is satisfied — but the pending
    // count must still say so; a satisfying local animation is never a claim
    // the server has confirmed anything.
    expect(await screen.findByText(/1 waiting to send/)).toBeInTheDocument();
  });

  it("task 73: clears a typed note after a successful record so it doesn't ride along on the next tap", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    const saved = richEnvelope("trip-1");
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockResolvedValue(saved);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    fireEvent.click(screen.getByText("Add a note to this roll-call record"));
    const noteInput = screen.getByLabelText("Optional note") as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "Missed the morning van" } });
    expect(noteInput.value).toBe("Missed the morning van");

    fireEvent.click(screen.getByRole("button", { name: "Mark not boarded" }));

    await waitFor(() =>
      expect(appendOfflineRollCall).toHaveBeenCalledWith("trip-1", {
        bookingId: "diver-priya",
        checkpoint: "departure",
        status: "not_boarded",
        note: "Missed the morning van",
      }),
    );
    await waitFor(() => expect(noteInput.value).toBe(""));
  });

  it("ports MissingDiversGrid: an awaiting diver appears as a tap target", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(screen.getByRole("button", { name: /Priya/ })).toBeInTheDocument();
  });

  it("ports the WaterLocker disable toggle onto the offline surface", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(
      await screen.findByRole("checkbox", { name: "Disable spray guard on this device" }),
    ).toBeInTheDocument();
  });
});
