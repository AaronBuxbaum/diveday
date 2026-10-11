// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeDiscardedOfflineRecords,
  listOfflineManifests,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { OfflineManifestView } from "./OfflineManifestView";
import { envelope, FROZEN_MS, identityResponse, setOnline } from "./offline-manifest/view-fixtures";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/offline-manifest-store", async () => ({
  // The real class, not a stand-in: the view branches on
  // `error instanceof OfflineManifestError` and then on `error.code`, so a
  // duplicate declared here would make every refusal fall through to the
  // generic message and the copy tests below would assert nothing.
  OfflineManifestError: (
    await vi.importActual<typeof import("@/lib/offline-manifest-store")>(
      "@/lib/offline-manifest-store",
    )
  ).OfflineManifestError,
  // The counter's queue is a *different* writer from roll call's, and this
  // mock keeps them apart so a test can prove which one a tap reached
  // (ADR 20260907-the-counter-survives-offline).
  appendOfflineArrival: vi.fn(),
  appendOfflineRollCall: vi.fn(),
  listOfflineManifests: vi.fn(),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue(undefined),
  syncOfflineManifest: vi.fn(),
  // The retention ceiling's discard notice: nothing thrown away is the right
  // default for every test that isn't about one.
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  // The version-mismatch banner (task 124) resolves this on mount; no active
  // worker in jsdom, so "nothing to warn about" is the correct default here.
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  searchParams = new URLSearchParams();
  setOnline(true);
  // reconcileList learns "the currently authenticated shop" from this same
  // endpoint before syncing any pending event — default to matching the
  // fixtures' own shop ("blue-mantis") so existing reconcile tests keep
  // working; tests for the cross-shop case override this per-call.
  // A fresh Response per call: a body can be consumed only once, and more than
  // one caller reaches this endpoint per mount.
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

describe("OfflineManifestView — list mode (no ?trip=)", () => {
  it("lists every saved trip with its shop and diver count, and badges none of them while all are current", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-1", "Two-Tank Reef — Molasses & French", {
        savedAt: new Date(FROZEN_MS).toISOString(),
      }),
      envelope("trip-2", "Deep Wreck Charter", {
        savedAt: new Date(FROZEN_MS).toISOString(),
      }),
    ]);

    render(<OfflineManifestView />);

    expect(await screen.findByText("Two-Tank Reef — Molasses & French")).toBeInTheDocument();
    expect(screen.getAllByText(/2 divers/)).toHaveLength(2);
    // The state every row is normally in gets no pill at all — principle 9's
    // badge rule — so that a pill appearing anywhere on this list means one
    // copy needs a look. Freshness is still stated, once, for the group.
    expect(screen.queryByText("Fresh copy")).not.toBeInTheDocument();
    expect(screen.getByText("All up to date.")).toBeInTheDocument();
    // Still shown, and still unconditionally — this view has no reliable way
    // to know "the current shop" while genuinely offline, so the boundary has
    // to be visible rather than inferred (see the cross-shop test below for
    // why this matters). It has moved to the header, which is where the
    // question a crew member on a shared device actually has gets answered.
    expect(screen.getByText("Blue Mantis Divers")).toBeInTheDocument();
  });

  it("names the age and the action on a copy that is no longer current, and only on that copy", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-1", "Fresh Trip", { savedAt: new Date(FROZEN_MS).toISOString() }),
      envelope("trip-2", "Old Trip", {
        savedAt: new Date(FROZEN_MS - 4 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(FROZEN_MS + 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    render(<OfflineManifestView />);

    // Principle 4's carve-out, verbatim: the age in human words and what to do
    // about it — never a tier name like "Stale copy".
    expect(await screen.findByText("Saved 4 hours ago")).toBeInTheDocument();
    expect(screen.getByText("Refresh before you rely on it")).toBeInTheDocument();
    expect(screen.queryByText("Stale copy")).not.toBeInTheDocument();
    expect(screen.queryByText("Aging copy")).not.toBeInTheDocument();
    // The header stops claiming everything is fine the moment one copy isn't,
    // and counts only the copies that need a look.
    expect(screen.queryByText("All up to date.")).not.toBeInTheDocument();
    expect(screen.getByText("1 copy needs refreshing.")).toBeInTheDocument();
  });

  it("keeps the shop on each row, and out of the header, while two shops' records sit side by side", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-1", "Ours", { savedAt: new Date(FROZEN_MS).toISOString() }),
      envelope("trip-2", "Theirs", {
        savedAt: new Date(FROZEN_MS).toISOString(),
        shopSlug: "coral-cay",
        shopName: "Coral Cay Divers",
      }),
    ]);

    render(<OfflineManifestView />);

    await screen.findByText("Ours");
    // A single header name over records belonging to two shops would be a lie
    // about half the list, so in the window before the cross-shop purge runs
    // the name stays where it distinguishes them.
    expect(screen.getByText(/Blue Mantis Divers ·/)).toBeInTheDocument();
    expect(screen.getByText(/Coral Cay Divers ·/)).toBeInTheDocument();
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
    expect(await screen.findByText("Everything’s sent across these trips.")).toBeInTheDocument();
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
          occurredAt: new Date(FROZEN_MS).toISOString(),
          syncStatus: "pending",
        },
      ],
    });
    vi.mocked(listOfflineManifests).mockResolvedValue([foreignShopEnvelope]);
    // The device is currently signed in as blue-mantis, not reef-runners.
    vi.mocked(fetch).mockResolvedValue(identityResponse("blue-mantis"));

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

  // SEC-D3 (review 20260802). The purge used to fire only from
  // OfflineManifestAutoSave, which mounts in the staff shop layout — so a
  // captain who only ever opens this shell on a shared or reassigned boat
  // tablet kept the previous shop's roster decryptable indefinitely. This
  // surface is where those records are read, so it is where the second trigger
  // belongs.
  it("purges another shop's leftover records when the shell loads", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);
    vi.mocked(fetch).mockResolvedValue(identityResponse("blue-mantis"));

    render(<OfflineManifestView />);

    await screen.findByText("Two-Tank Reef");
    // The server-verified slug, never one read off a snapshot this device holds.
    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis"),
    );
    // And the list is re-read afterwards, so a record the purge removed stops
    // being displayed within the same round rather than until the next visit.
    await waitFor(() =>
      expect(vi.mocked(listOfflineManifests).mock.invocationCallOrder.at(-1)).toBeGreaterThan(
        vi.mocked(purgeOfflineManifestsExceptShop).mock.invocationCallOrder[0],
      ),
    );
  });

  // Review 20260802, action item 12. This shell needs one string — which shop
  // this browser is signed in as — and used to get it by asking for the shop's
  // whole 48-hour roster: every diver's name, emergency contact and readiness
  // blocker, pulled onto a shared boat tablet and then thrown away unread.
  it("asks the identity endpoint for the tenant, and never pulls the roster to get it", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);

    render(<OfflineManifestView />);

    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis"),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/offline-manifests/identity",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    // Not "called with /upcoming fewer times" — never, on any URL. This surface
    // has no use for a roster it did not already save.
    for (const [url] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).not.toContain("/api/offline-manifests/upcoming");
    }
  });

  // The 2026-08-06 deduplication, still holding after the endpoint changed
  // shape. Two independent consumers want the tenant on every mount and every
  // reconnect — the purge effect and the branch effect that gates reconcile —
  // and each request can sit for the full ten-second timeout on a marina
  // connection. Two of them can also come back disagreeing, which would have
  // the purge and the reconcile acting on different answers to "which shop is
  // this".
  it("resolves the tenant once per round, however many callers need it", async () => {
    const pendingEvent = {
      clientEventId: "evt-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
      tripId: "trip-1",
      bookingId: "booking-1",
      checkpoint: "departure" as const,
      status: "boarded" as const,
      occurredAt: new Date(FROZEN_MS).toISOString(),
      syncStatus: "pending" as const,
    };
    const saved = envelope("trip-1", "Two-Tank Reef", { events: [pendingEvent] });
    vi.mocked(listOfflineManifests).mockResolvedValue([saved]);
    vi.mocked(syncOfflineManifest).mockResolvedValue({
      ...saved,
      events: [{ ...pendingEvent, syncStatus: "applied" }],
    });

    render(<OfflineManifestView />);

    // Both consumers have run: the purge fired and the pending event synced.
    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis"),
    );
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledWith("trip-1"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // The whole reason the tenant is re-verified from the server on every
  // reconnect rather than cached: a reconnect is exactly when the signed-in
  // shop may have changed (a shared boat tablet handed to the next operator).
  it("purges against the new shop when the identity changes on reconnect", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);
    vi.mocked(fetch).mockImplementation(async () => identityResponse("blue-mantis"));

    render(<OfflineManifestView />);
    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis"),
    );

    // A different shop's staff signs in on this tablet.
    vi.mocked(fetch).mockImplementation(async () => identityResponse("reef-runners"));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    // The purge follows the *new* answer, so blue-mantis's rosters are the ones
    // that stop being decryptable on this device.
    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("reef-runners"),
    );
  });

  // Security review, 2026-08-06: `?trip=<id>` is the URL the list itself links
  // to and the one `manifest-sw.js` replays after a failed reload, so it is what
  // a captain actually bookmarks — a purge that ran only on the list branch
  // would miss exactly the person SEC-D3 exists for.
  it("purges on the single-trip surface too, not only on the list", async () => {
    searchParams = new URLSearchParams("trip=trip-1");
    vi.mocked(loadOfflineManifest).mockResolvedValue(envelope("trip-1", "Two-Tank Reef"));
    vi.mocked(fetch).mockResolvedValue(identityResponse("blue-mantis"));

    render(<OfflineManifestView />);

    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis"),
    );
  });

  // The purge needs a server round trip to learn the tenant; the roll call does
  // not. A captain on a marina connection must get the list this device already
  // holds without waiting on the network — this surface exists precisely for
  // the case where the network is the thing that isn't working.
  it("paints the device's list before consulting the network", async () => {
    let releaseFetch: (value: Response) => void = () => {};
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        releaseFetch = resolve;
      }),
    );

    render(<OfflineManifestView />);

    // Painted while the request is still outstanding.
    expect(await screen.findByText("Two-Tank Reef")).toBeInTheDocument();
    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();

    releaseFetch(identityResponse("blue-mantis"));
    await waitFor(() => expect(purgeOfflineManifestsExceptShop).toHaveBeenCalled());
  });

  it("purges nothing when the current shop cannot be established", async () => {
    // Genuinely offline: there is no way to learn which tenant this browser is
    // signed in as, and guessing would delete the copy a captain is standing on
    // the dock holding. Fail toward keeping the records, and toward showing them.
    setOnline(false);
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);

    render(<OfflineManifestView />);

    await screen.findByText("Two-Tank Reef");
    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("purges nothing when the identity endpoint refuses the caller", async () => {
    // The session expired, or this browser was never signed in — the shell
    // itself is deliberately reachable without one. A 401 is "cannot establish
    // the tenant", never "the tenant is nobody", and purging on it would delete
    // every roster on the device.
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "authentication_required" }), { status: 401 }),
    );

    render(<OfflineManifestView />);

    await screen.findByText("Two-Tank Reef");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();
    expect(syncOfflineManifest).not.toHaveBeenCalled();
  });

  it("purges nothing when the identity response carries no slug", async () => {
    // A 200 whose body is the wrong shape — a proxy's error page, a truncated
    // response, a future version of the route — must read as "cannot establish
    // the tenant" and not as `purgeOfflineManifestsExceptShop(undefined)`,
    // which matches no saved record and would delete every one of them.
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    render(<OfflineManifestView />);

    await screen.findByText("Two-Tank Reef");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();
  });

  it("still lists the device's records when the purge itself fails", async () => {
    // Unlike the auto-save path, which fails its whole round rather than write
    // a second shop's rosters in beside the first, this surface must still
    // paint: refusing to show a captain the manifest they came for does not
    // remove the foreign record, it only removes the working one.
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);
    vi.mocked(purgeOfflineManifestsExceptShop).mockRejectedValueOnce(new Error("storage gone"));

    render(<OfflineManifestView />);

    expect(await screen.findByText("Two-Tank Reef")).toBeInTheDocument();
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

  /**
   * The marker `scripts/screenshot.mjs` waits on (issue #2235): absent while
   * the store is being opened, set once it has been read, gone on unmount.
   */
  it("marks the document settled once the store has been read, and not before", async () => {
    let answer: (value: OfflineManifestEnvelope[]) => void = () => {};
    vi.mocked(listOfflineManifests).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const view = render(<OfflineManifestView />);
    expect(document.documentElement.dataset.offlineSettled).toBeUndefined();

    await act(async () => answer([]));
    expect(await screen.findByText("Nothing saved on this device yet")).toBeInTheDocument();
    expect(document.documentElement.dataset.offlineSettled).toBe("");

    view.unmount();
    expect(document.documentElement.dataset.offlineSettled).toBeUndefined();
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
      expect(await screen.findByText("All up to date.")).toBeInTheDocument();

      // 20 minutes later — past the 15-minute "current" threshold — but
      // nothing has re-rendered yet, so the row should still read stale info.
      process.env.DIVEDAY_CLOCK = new Date(FROZEN_MS + 20 * 60 * 1000).toISOString();
      expect(screen.getByText("All up to date.")).toBeInTheDocument();

      expect(tick).toBeDefined();
      act(() => tick?.());

      // The pill appears at the moment the copy stops being current, carrying
      // its age — and the group line stops saying everything is fine.
      expect(await screen.findByText("Saved 20 minutes ago")).toBeInTheDocument();
      expect(screen.getByText("1 copy needs refreshing.")).toBeInTheDocument();
      expect(screen.queryByText("All up to date.")).not.toBeInTheDocument();
    } finally {
      process.env.DIVEDAY_CLOCK = originalClock;
    }
  });
});

describe("OfflineManifestView — never claims what it hasn't read", () => {
  // The shell is the surface a captain reaches with no signal, so "nothing is
  // saved on this phone" has to mean the store was opened and found empty —
  // not that the read hasn't come back yet. It is also what makes the server
  // render URL-agnostic, which matters because manifest-sw.js caches one
  // document and replays it for every offline reload whatever `?trip=` was
  // asked for (see the `storeRead` comment in OfflineManifestView.tsx).
  it("says it is opening the copy, not that there isn't one, until the store answers", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    let resolveLoad: (value: OfflineManifestEnvelope | null) => void = () => {};
    vi.mocked(loadOfflineManifest).mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    render(<OfflineManifestView />);

    expect(screen.getByText("Opening this device’s saved copy")).toBeInTheDocument();
    expect(screen.queryByText("Nothing saved on this phone yet")).not.toBeInTheDocument();

    await act(async () => {
      resolveLoad(null);
    });

    expect(await screen.findByText("Nothing saved on this phone yet")).toBeInTheDocument();
  });

  it("does the same for the device-wide list", async () => {
    searchParams = new URLSearchParams();
    let resolveList: (value: OfflineManifestEnvelope[]) => void = () => {};
    vi.mocked(listOfflineManifests).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    render(<OfflineManifestView />);

    expect(screen.getByText("Opening this device’s saved copy")).toBeInTheDocument();
    expect(screen.queryByText("Nothing saved on this device yet")).not.toBeInTheDocument();

    await act(async () => {
      resolveList([]);
    });

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

// Security review, 2026-08-06 (F5). The purge repainted only the list branch —
// `setList((current) => (current === null ? current : saved))` is what confined
// it there — so on `?trip=<id>` the component kept rendering the in-memory
// envelope of a record that had just been deleted, and every Board /
// Not-boarded button raised `OfflineManifestError("unavailable")`. A captain at
// the dock got a roster that looked fine, dead buttons, and a refusal that
// explained nothing.
describe("OfflineManifestView — when a purge deletes the record on screen", () => {
  /**
   * Renders a single-trip view already showing `shown`, then hands the tablet
   * to whoever `signedInAs` says — the reconnect that fires the purge. The
   * store's answer after that purge is `afterPurge`: an envelope (it survived),
   * null (deleted), or a rejection (the read failed).
   */
  async function handOverTablet({
    shown,
    signedInAs,
    afterPurge,
  }: {
    shown: OfflineManifestEnvelope;
    signedInAs: string;
    afterPurge: OfflineManifestEnvelope | null | Error;
  }) {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    let held: OfflineManifestEnvelope | null | Error = shown;
    vi.mocked(loadOfflineManifest).mockImplementation(async () => {
      if (held instanceof Error) throw held;
      return held;
    });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(fetch).mockImplementation(async () => identityResponse(signedInAs));

    render(<OfflineManifestView />);
    // Wait for the roster to actually paint before the handover, so the test is
    // about the repaint and not about which effect happened to land first.
    await screen.findByRole("heading", { name: shown.snapshot.manifests[0].trip.title });

    vi.mocked(purgeOfflineManifestsExceptShop).mockImplementation(async () => {
      held = afterPurge;
    });
    // The round the mount already ran has to be excluded, or every wait below
    // is satisfied before the handover even happens.
    const roundsBefore = vi.mocked(readDiscardedOfflineRecords).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    // Wait on the *end* of the purge round, not on its purge call. The round
    // deletes, re-reads, decides whether to repaint, and only then asks what
    // the retention ceiling threw away — so this last read is the one signal
    // that the repaint decision has actually been made. Waiting on
    // `purgeOfflineManifestsExceptShop` instead (or on `loadOfflineManifest`
    // being called again) waits for a step that happens *before* the decision,
    // which lets the three cases below that assert a repaint did **not** happen
    // pass by checking too early.
    await waitFor(() =>
      expect(vi.mocked(readDiscardedOfflineRecords).mock.calls.length).toBeGreaterThan(
        roundsBefore,
      ),
    );
  }

  it("repaints, and names the cause, when the record it was showing belonged to another shop", async () => {
    await handOverTablet({
      shown: envelope("trip-1", "Shop A's Trip", {
        shopSlug: "reef-runners",
        shopName: "Reef Runners",
      }),
      signedInAs: "blue-mantis",
      afterPurge: null,
    });

    // Not "Nothing saved on this phone yet" — the one sentence the captain
    // already knows is wrong — and not the hint telling them to open a live
    // manifest that isn't theirs to open.
    expect(await screen.findByText("That saved copy has been removed")).toBeInTheDocument();
    expect(screen.getByText(/A different shop is signed in on this tablet/)).toBeInTheDocument();
    expect(screen.getByText(/saved by a different shop/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing saved on this phone yet")).not.toBeInTheDocument();
    // And the roster — another shop's divers, emergency contacts and readiness
    // blockers, on a tablet now signed in as someone else — is off the screen,
    // along with the buttons that could only have thrown.
    expect(screen.queryByRole("heading", { name: "Shop A's Trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark boarded/ })).not.toBeInTheDocument();
  });

  it("keeps showing the roster when the record survives the purge", async () => {
    // The pending-event exception: a foreign record still holding unsynced roll
    // call is deliberately preserved, and preserved means still readable.
    const preserved = envelope("trip-1", "Shop A's Trip", {
      shopSlug: "reef-runners",
      shopName: "Reef Runners",
    });
    await handOverTablet({ shown: preserved, signedInAs: "blue-mantis", afterPurge: preserved });

    expect(screen.getByRole("heading", { name: "Shop A's Trip" })).toBeInTheDocument();
    expect(screen.queryByText("That saved copy has been removed")).not.toBeInTheDocument();
  });

  it("never blanks the roster because the store read failed", async () => {
    // "Gone" and "couldn't ask" are different answers. Only a store that
    // positively says the record is deleted takes a manifest off a captain's
    // screen — a storage hiccup must not.
    await handOverTablet({
      shown: envelope("trip-1", "Shop A's Trip", {
        shopSlug: "reef-runners",
        shopName: "Reef Runners",
      }),
      signedInAs: "blue-mantis",
      afterPurge: new Error("storage gone"),
    });

    expect(screen.getByRole("heading", { name: "Shop A's Trip" })).toBeInTheDocument();
    expect(screen.queryByText("That saved copy has been removed")).not.toBeInTheDocument();
  });

  it("repaints when the purge outruns the very read that puts the record on screen", async () => {
    // The ordering a real tablet hits whenever the tenant lookup is warm and
    // the store is cold: `?trip=<id>`'s first decrypt is still in flight when
    // the purge round deletes the record it is decrypting. The read was issued
    // before the delete, so it still comes back holding the foreign roster —
    // and hands it to the view *after* the purge has looked and moved on.
    //
    // Nothing is on screen at the moment the purge asks, and "I can't see a
    // record" is not "there is no record": the read is one microtask away from
    // painting the very thing the purge just deleted. A repaint conditioned on
    // what has already painted is therefore skipped exactly here, and the
    // captain is left holding another shop's divers, emergency contacts and
    // readiness blockers on a tablet signed in as someone else — with dead
    // Board buttons, which is the F5 disclosure this whole block exists to end.
    searchParams = new URLSearchParams({ trip: "trip-1" });
    const foreign = envelope("trip-1", "Shop A's Trip", {
      shopSlug: "reef-runners",
      shopName: "Reef Runners",
    });
    let releaseFirstRead: (envelope: OfflineManifestEnvelope) => void = () => {};
    const firstRead = new Promise<OfflineManifestEnvelope>((resolve) => {
      releaseFirstRead = resolve;
    });
    let held: OfflineManifestEnvelope | null = foreign;
    let reads = 0;
    vi.mocked(loadOfflineManifest).mockImplementation(async () => {
      reads += 1;
      // Only the view's own opening read is held back; the purge's re-read
      // answers immediately, exactly as a store that has just deleted a key
      // would.
      return reads === 1 ? firstRead : held;
    });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(fetch).mockImplementation(async () => identityResponse("blue-mantis"));
    vi.mocked(purgeOfflineManifestsExceptShop).mockImplementation(async () => {
      held = null;
    });

    render(<OfflineManifestView />);
    // The purge round runs to completion first — deleting, re-reading, and
    // deciding — with nothing painted. See `handOverTablet` for why the round's
    // closing read is what proves the decision was made.
    await waitFor(() => expect(readDiscardedOfflineRecords).toHaveBeenCalled());

    // ...and only now does the read that was already in flight come back,
    // carrying the copy the purge deleted while it was running.
    await act(async () => {
      releaseFirstRead(foreign);
    });

    expect(await screen.findByText("That saved copy has been removed")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Shop A's Trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark boarded/ })).not.toBeInTheDocument();
  });

  it("does not blame another shop when this shop's own record ages out under it", async () => {
    // The same repaint, a different sentence: nothing crossed a tenant
    // boundary here, so the ordinary empty state is the honest one.
    await handOverTablet({
      shown: envelope("trip-1", "Two-Tank Reef"),
      signedInAs: "blue-mantis",
      afterPurge: null,
    });

    expect(await screen.findByText("Nothing saved on this phone yet")).toBeInTheDocument();
    expect(
      screen.getByText("There’s no current saved manifest for this trip on this device."),
    ).toBeInTheDocument();
    expect(screen.queryByText("That saved copy has been removed")).not.toBeInTheDocument();
  });
});

// Security review, 2026-08-06 (F3). Past its ceiling the store discards a
// record even when it still holds roll call that never synced — unsynced
// evidence of who came back from a dive. Deleting that quietly is its own
// harm, so the store writes the loss down and this surface is where a human
// finally hears about it: the delete itself usually happens with no page open
// at all (the service worker's push refresh, the staff layout's auto-save).
describe("OfflineManifestView — reporting roll call the ceiling threw away", () => {
  const discarded = [
    {
      tripId: "trip-9",
      tripTitle: "Morning Two-Tank",
      shopName: "Reef Runners",
      pendingEvents: 2,
      discardedAt: new Date(FROZEN_MS).toISOString(),
    },
  ];

  // `vi.clearAllMocks()` keeps implementations, so restate the quiet default
  // per test rather than letting one case's notice bleed into the next.
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
    // A reconnect — the moment everything else on this surface re-reads and
    // repaints — must not quietly clear it.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(notice).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));

    await waitFor(() => expect(acknowledgeDiscardedOfflineRecords).toHaveBeenCalled());
    expect(
      screen.queryByText("Roll call that never sent has been removed"),
    ).not.toBeInTheDocument();
  });

  it("says nothing at all when nothing has been thrown away", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-1", "Two-Tank Reef")]);

    render(<OfflineManifestView />);

    await screen.findByText("Two-Tank Reef");
    expect(
      screen.queryByText("Roll call that never sent has been removed"),
    ).not.toBeInTheDocument();
  });
});
