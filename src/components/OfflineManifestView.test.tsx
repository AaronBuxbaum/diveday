// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeDiscardedOfflineRecords,
  appendOfflineRollCall,
  listOfflineManifests,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
  readDiscardedOfflineRecords,
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
          notBackAboard: 0,
          awaiting: totalDivers,
          unaccountedFor: totalDivers,
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
    /**
     * Crew were counted at both checkpoints before the snapshot was saved —
     * both halves: the attested count *and* a per-person result for each crew
     * member. Divers alone no longer close a checkpoint (DOM-H1, ADRs
     * 20260802-crew-roll-call-attestation and
     * 20260803-per-person-crew-roll-call), so anything asserting "roll call
     * complete" needs this; anything asserting it *stays open* leaves it off.
     */
    crewCalled?: boolean;
    /** One named crew member has no result of their own at this checkpoint. */
    crewMemberUncounted?: boolean;
    /** A named crew member the crew recorded as *not back aboard* after the dive. */
    crewNotBackAboard?: boolean;
    /** Two crew who share a full name and a role — the list-key collision. */
    crewNamesake?: boolean;
    /**
     * A copy saved **before H-46**, whose crew carry no person id. Those crew
     * have no subject to record an event against, so the copy can only ever
     * show their save-time result and the checkpoint stays open — the
     * fail-closed direction (`crewOlderCopy`, `canRecordOfflineCrewStatus`).
     */
    crewWithoutIds?: boolean;
  } = {},
): OfflineManifestPayload {
  // Every charter is crewed, so both cases carry the same two people; the
  // difference under test is whether anyone called them.
  const crewRollCall = opts.crewCalled
    ? {
        state: "boarded" as const,
        occurredAt: "2026-08-01T12:55:00.000Z",
        recordedByName: "Dana Divemaster",
        note: null,
      }
    : undefined;
  // A current copy carries person ids (H-46) — that is what makes the crew half
  // recordable here at all. `crewWithoutIds` is the copy a device saved before
  // that, still sitting in IndexedDB and still having to render.
  const crewId = (id: string) => (opts.crewWithoutIds ? undefined : id);
  const crew = opts.crewNamesake
    ? [
        {
          id: crewId("crew-sal-1"),
          fullName: "Sal Ortiz",
          roles: ["captain"],
          rollCall: crewRollCall,
        },
        {
          id: crewId("crew-sal-2"),
          fullName: "Sal Ortiz",
          roles: ["captain"],
          rollCall: undefined,
        },
      ]
    : [
        {
          id: crewId("crew-dana"),
          fullName: "Dana Divemaster",
          roles: ["divemaster"],
          rollCall: crewRollCall,
        },
        {
          id: crewId("crew-sal"),
          fullName: "Sal Ortiz",
          roles: ["captain"],
          rollCall: opts.crewNotBackAboard
            ? {
                state: "not_boarded" as const,
                occurredAt: "2026-08-01T14:55:00.000Z",
                recordedByName: "Dana Divemaster",
                note: null,
              }
            : opts.crewMemberUncounted
              ? undefined
              : crewRollCall,
        },
      ];
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
        crew,
        divers,
        summary: {
          totalDivers: divers.length,
          ready: divers.filter((d) => d.readiness.status === "ready").length,
          blocked: divers.filter((d) => d.readiness.status === "blocked").length,
          boarded: 0,
          notBoarded: 0,
          notBackAboard: 0,
          awaiting: divers.length,
          unaccountedFor: divers.length,
        },
      },
      {
        trip,
        checkpoint: "after_dive_1",
        crew,
        divers: diversAfterDive,
        summary: {
          totalDivers: diversAfterDive.length,
          ready: diversAfterDive.filter((d) => d.readiness.status === "ready").length,
          blocked: diversAfterDive.filter((d) => d.readiness.status === "blocked").length,
          boarded: 0,
          notBoarded: opts.withCarriedNotBoarded ? 1 : 0,
          notBackAboard: 0,
          awaiting: opts.withCarriedNotBoarded
            ? diversAfterDive.length - 1
            : diversAfterDive.length,
          unaccountedFor: opts.withCarriedNotBoarded
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

/**
 * What `GET /api/offline-manifests/identity` answers: the tenant slug, and
 * nothing else. This shell asks a one-word question and now gets a one-word
 * answer — it used to call `/upcoming`, which replies with the shop's entire
 * 48-hour board (review 20260802, action item 12).
 */
function identityResponse(shopSlug: string) {
  return new Response(JSON.stringify({ shop: { slug: shopSlug } }), { status: 200 });
}

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
      note: null,
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

    expect(screen.getByText("Opening this device's saved copy")).toBeInTheDocument();
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

    expect(screen.getByText("Opening this device's saved copy")).toBeInTheDocument();
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

  it("invariant 4 / DOM-H3: recording a diver as not back aboard after a dive neither closes the checkpoint nor celebrates", async () => {
    // SubSurfaceRipple only ever fires on a false→true *transition* of its
    // `complete` prop (see its own component) — a manifest that is already
    // "complete" on the very first render can never exercise the gate this
    // test is for, so this drives a real transition: mount not-complete
    // (Priya still awaiting), then record Priya at an *after-dive* checkpoint
    // with the only control that isn't "Boarded". Every diver now has a result
    // — `awaiting` hits zero, Marcus was already carried not-boarded from the
    // dock — and neither the celebration nor "complete" may follow from that:
    // Priya has not come back from dive one.
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { withCarriedNotBoarded: true, crewCalled: true });
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

    // After a dive the control is worded for what it means here, and never
    // settles into a green-checked "Not boarded ✓" beside a diver in the water.
    expect(screen.queryByRole("button", { name: "Mark not boarded" })).not.toBeInTheDocument();
    const priyaRow = () => {
      const row = document.getElementById("offline-roll-call-diver-priya");
      if (!row) throw new Error("Priya's row missing");
      return within(row);
    };
    fireEvent.click(priyaRow().getByRole("button", { name: "Mark not back aboard" }));
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    // Every diver has a result, but one of them did not come back: the
    // checkpoint stays open, exactly as the live manifest reports it.
    await waitFor(() =>
      expect(priyaRow().getByRole("button", { name: "Not back aboard" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Not boarded ☑️/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "After dive 1 roll call" })).toBeInTheDocument();
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

    fireEvent.click(screen.getByText("Add a note"));
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

/**
 * DOM-H1. "Complete" is one definition (`rollCallCompleteness`,
 * src/lib/manifests.ts), consumed by the live manifest and by this view. It
 * used to be written inline in both places as divers-only, so a checkpoint
 * with every booked diver counted read complete with the crew unaccounted
 * for. A crew roll call is recordable offline now (H-46), and the one thing
 * that must still never happen is unchanged: the dock copy reading "complete"
 * while the live page says the checkpoint is still open.
 */
describe("OfflineManifestView — crew are part of the head count offline too", () => {
  it("does not read complete when every diver has a result but the crew were never called", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    // No `crewCalled` — a snapshot saved before anyone called the crew.
    const saved = richEnvelope("trip-1", { withCarriedNotBoarded: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockResolvedValue({
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
    });

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // Priya is the only diver still awaiting (Marcus is carried not-boarded).
    fireEvent.click(screen.getAllByRole("button", { name: "Mark boarded" })[0] as HTMLElement);
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    // Both divers now have a result — the old divers-only rule called this
    // complete, on both surfaces.
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    // And it says why, rather than going quiet — naming the count that is
    // holding it open, in the same words the live manifest uses.
    expect(screen.getByText(/2 crew members still to call/)).toBeInTheDocument();
    expect(
      screen.getByText(/Every person on the crew list needs a result of their own/),
    ).toBeInTheDocument();
    // And the way to close it is right there, on this copy, with no signal:
    // one aboard control per crew member, which is the whole point of H-46.
    expect(screen.getAllByRole("button", { name: "Mark aboard" })).toHaveLength(2);
  });

  it("reads complete once the saved snapshot has a result for every assigned crew member", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { withCarriedNotBoarded: true, crewCalled: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockResolvedValue({
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
    });

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // The saved count is shown, attributed — a head count is never anonymous.
    expect(screen.getByText(/All 2 crew accounted for/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Mark boarded" })[0] as HTMLElement);
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    expect(await screen.findByText(/Roll call complete/)).toBeInTheDocument();
  });

  /**
   * DOM-H1's per-person half, offline (ADR 20260803-per-person-crew-roll-call).
   * A count names nobody, so a saved "2 of 2 aboard" cannot tell this device
   * that the second body was the deckhand rather than the divemaster still
   * down. Crew results are read-only here — recording one needs signal — and
   * their absence reads as *not counted*, which is what keeps the dock copy
   * fail-closed rather than ahead of the live page.
   */
  it("stays open, and says who, when a named crew member has no saved result", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewMemberUncounted: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    vi.mocked(appendOfflineRollCall).mockResolvedValue({
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
    });

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    fireEvent.click(screen.getAllByRole("button", { name: "Mark boarded" })[0] as HTMLElement);
    await waitFor(() => expect(appendOfflineRollCall).toHaveBeenCalled());

    // Every diver counted, every crew member called — and still not complete.
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 crew member still to call/)).toBeInTheDocument();
    // Named, not just counted: the captain nobody has tapped is on screen.
    expect(screen.getByText(/Sal Ortiz · Awaiting/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Divemaster · Boarded/)).toBeInTheDocument();
  });
});

/**
 * Review 20260803, D6, re-read after H-46. "A crew member is still to call"
 * and "a crew member is unaccounted for" are different facts, and a crew
 * seeing warning-yellow on every single dive stops reading it at all. What
 * changed is which of the two an ordinary out-of-signal trip produces: the
 * crew half is now recordable here, so an uncalled crew member is work in
 * front of the deck rather than a limitation to apologise for. The apology is
 * left for the one copy that genuinely cannot do it — one saved before crew
 * ids rode along — and even that stays calm-toned.
 */
describe("OfflineManifestView — the crew panel tells apart 'still to call' from 'missing'", () => {
  it("does not apologise on a current copy: an uncalled crew member is work, and untoned", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewMemberUncounted: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    // Still open — the fail-closed rule is untouched.
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    const note = screen.getByText(/1 crew member still to call/);
    const panel = note.closest("div");
    expect(panel?.className).not.toContain("warning");
    expect(panel?.className).not.toContain("danger");
    // The limitation line belongs to an older copy only, and this is not one.
    expect(screen.queryByText(/saved before crew roll call worked offline/)).toBeNull();
  });

  /**
   * Invariant I2, on screen. A copy saved before H-46 has crew with no person
   * id, so there is no subject a tap could be about. It says so — with a
   * count, so a captain can tell one late addition from the whole crew — the
   * checkpoint stays open, and no aboard control is offered for somebody the
   * device cannot name to the server.
   */
  it("says so, calmly and with a count, when the saved copy predates crew ids", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewMemberUncounted: true,
      crewWithoutIds: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    const note = screen.getByText(/2 crew members on this saved copy can’t be called here/);
    expect(note).toBeInTheDocument();
    const panel = note.closest("div");
    expect(panel?.className).not.toContain("warning");
    expect(panel?.className).not.toContain("danger");
    // No control for a person this copy cannot name to the server.
    expect(screen.queryByRole("button", { name: "Mark aboard" })).toBeNull();
  });

  it("does alarm, in danger tone, when a named crew member is not back aboard", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", {
      withCarriedNotBoarded: true,
      crewCalled: true,
      crewNotBackAboard: true,
    });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    const alarm = screen.getByText(/1 crew member is not back aboard/);
    expect(alarm.closest("div")?.className).toContain("danger");
    // This one is emphatically *not* "we can't record it here".
    expect(screen.queryByText(/can’t be tapped from this saved copy/)).not.toBeInTheDocument();
    expect(screen.getByText(/Sal Ortiz · Not back aboard/)).toBeInTheDocument();
  });

  it("renders two crew who share a name and a role as two separate people", async () => {
    // The list key was `fullName-roles`, so a namesake pair collided — which is
    // exactly what `ManifestCrewMember.id` prevents on the live manifest. The
    // dock copy carries no person ids by design, so its key is the position.
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    const saved = richEnvelope("trip-1", { crewCalled: true, crewNamesake: true });
    vi.mocked(loadOfflineManifest).mockResolvedValue(saved);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });
    expect(screen.getByText(/Sal Ortiz · Boarded/)).toBeInTheDocument();
    expect(screen.getByText(/Sal Ortiz · Awaiting/)).toBeInTheDocument();
  });
});

/**
 * DOM-H3. The dock copy and the live manifest read the same rows through the
 * same predicate and the same word list (`isNotBackAboard` / `rollCallLabel` in
 * src/lib/manifests.ts, `rollCallLabelText` in src/i18n/manifest-labels.ts), so
 * neither can describe a diver in the water as settled while the other alarms.
 */
describe("OfflineManifestView — the two meanings of not_boarded, worded the same as online", () => {
  function envelopeWithServerResult(
    checkpoint: "departure" | "after_dive_1",
    rollCall: NonNullable<
      OfflineManifestPayload["manifests"][number]["divers"][number]["rollCall"]
    >,
  ) {
    const base = richEnvelope("trip-1", { crewCalled: true });
    return {
      ...base,
      snapshot: {
        ...base.snapshot,
        manifests: base.snapshot.manifests.map((manifest) =>
          manifest.checkpoint === checkpoint
            ? {
                ...manifest,
                divers: manifest.divers.map((diver) =>
                  diver.bookingId === "diver-priya" ? { ...diver, rollCall } : diver,
                ),
              }
            : manifest,
        ),
      },
    };
  }

  it("says “not back aboard” after a dive, and keeps the checkpoint open", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "after_dive_1" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      envelopeWithServerResult("after_dive_1", {
        state: "not_boarded",
        occurredAt: new Date(FROZEN_MS).toISOString(),
        recordedByName: "Dana Divemaster",
        note: "Not on the ladder",
      }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const priya = within(document.getElementById("offline-roll-call-diver-priya") as HTMLElement);
    // Both the state pill beside her name and the control below it.
    expect(priya.getAllByText("Not back aboard")).toHaveLength(2);
    expect(priya.queryByText("Not boarded")).not.toBeInTheDocument();
    expect(priya.queryByText("Not boarded ☑️")).not.toBeInTheDocument();
    // The whole roster has a result and the crew were counted — and it still
    // does not read complete, because one diver has not come back.
    expect(screen.queryByText(/Roll call complete/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "After dive 1 roll call" })).toBeInTheDocument();
  });

  it("keeps the dock's own wording — and its done-check — at departure", async () => {
    searchParams = new URLSearchParams({ trip: "trip-1", checkpoint: "departure" });
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      envelopeWithServerResult("departure", {
        state: "not_boarded",
        occurredAt: new Date(FROZEN_MS).toISOString(),
        recordedByName: "Dana Divemaster",
        note: "Never made the dock",
      }),
    );
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const priya = within(document.getElementById("offline-roll-call-diver-priya") as HTMLElement);
    expect(priya.getByText("Not boarded")).toBeInTheDocument();
    // Left ashore is a diver accounted for, so this one *is* a settled result.
    expect(priya.getByRole("button", { name: "Not boarded ☑️" })).toBeInTheDocument();
    expect(screen.queryByText("Not back aboard")).not.toBeInTheDocument();
    expect(await screen.findByText(/Roll call complete/)).toBeInTheDocument();
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
      screen.getByText("There's no current saved manifest for this trip on this device."),
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
      screen.getByText("Reef Runners · Morning Two-Tank — 2 changes lost"),
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

/**
 * The offline roll call and the live manifest are read minutes apart by the
 * same captain — at the dock on one, underway on the other — so a row that
 * folds its reference facts there and stands them open here is one job wearing
 * two layouts (FU-20260810-offline-manifest-checklist-grammar). These pin the
 * grammar itself, not just that the facts are somewhere in the DOM: a closed
 * `<details>` still renders its children, so a `getByText` assertion passes
 * identically before and after this change and proves nothing about it.
 */
describe("the row grammar the live manifest already reads", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ trip: "trip-1" });
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
  });

  it("puts a diver's contact and gear behind the same disclosure, under the same words", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const summary = screen.getAllByText("Contact & gear")[0];
    if (!summary) throw new Error("no facts disclosure");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    // Shut at rest, and holding the facts rather than sitting beside them.
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText("Anil Shah · +1-305-555-0177")).toBeTruthy();
  });

  it("drops the box off the exception control while boarding is still on offer", async () => {
    // Most people board, so an unrecorded "Mark not boarded" beside a live
    // "Mark boarded" is the exception at less than equal weight — no border,
    // no fill, full dock-sized target (design principle 8, and the rule
    // RollCallControls already applies on the live page).
    vi.mocked(loadOfflineManifest).mockResolvedValue(richEnvelope("trip-1"));

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    const exception = screen.getAllByRole("button", { name: "Mark not boarded" })[0];
    if (!exception) throw new Error("no exception control");
    expect(exception.className).not.toContain("border");
    // Demoted by losing its box, never its legibility: no `text-muted` on the
    // surface with the harshest viewing conditions.
    expect(exception.className).not.toContain("text-muted");
    // Still the full boat-sized target.
    expect(exception.className).toContain("min-h-14");
  });

  it("gives the box back when the exception control is the row's only one", async () => {
    // A blocked diver at the dock cannot board, so this is the whole row —
    // and a lone control with no box reads as decoration.
    vi.mocked(loadOfflineManifest).mockResolvedValue(
      richEnvelope("trip-1", { readiness: "blocked" }),
    );

    render(<OfflineManifestView />);
    await screen.findByRole("heading", { name: "Two-Tank Reef" });

    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
    const exception = screen.getAllByRole("button", { name: "Mark not boarded" })[0];
    if (!exception) throw new Error("no exception control");
    expect(exception.className).toContain("border");
  });
});
