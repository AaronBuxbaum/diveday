// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginOfflineTenantVerificationRound,
  primeOfflineManifestShell,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  wipeOfflineMedicalAlerts,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestPayload } from "@/lib/offline-manifests";
import { OfflineManifestAutoSave } from "./OfflineManifestAutoSave";

vi.mock("@/lib/offline-manifest-store", () => ({
  beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
  primeOfflineManifestShell: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn(),
  saveOfflineManifest: vi.fn(),
  wipeOfflineMedicalAlerts: vi.fn(),
}));

function payloadFor(tripId: string): OfflineManifestPayload {
  return {
    shop: {
      slug: "blue-mantis",
      name: "Blue Mantis Divers",
      timezone: "America/New_York",
      emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
    },
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
        summary: {
          totalDivers: 0,
          ready: 0,
          blocked: 0,
          boarded: 0,
          notBoarded: 0,
          notBackAboard: 0,
          awaiting: 0,
          unaccountedFor: 0,
          overCapacity: 0,
          notHere: 0,
        },
      },
    ],
  };
}

function upcomingResponse(
  payloads: OfflineManifestPayload[],
  viewer?: { personId: string },
  mayHoldMedicalAlertWords?: Record<string, boolean>,
) {
  return new Response(
    JSON.stringify({
      shop: { slug: "blue-mantis" },
      payloads,
      ...(viewer ? { viewer } : {}),
      ...(mayHoldMedicalAlertWords ? { mayHoldMedicalAlertWords } : {}),
    }),
    { status: 200 },
  );
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
  vi.mocked(purgeOfflineManifestsExceptShop).mockResolvedValue([]);
  vi.mocked(wipeOfflineMedicalAlerts).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setOnline(true);
});

describe("OfflineManifestAutoSave", () => {
  it("primes the shell, purges any other shop's leftover records, and saves every trip the upcoming endpoint returns", async () => {
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
    vi.mocked(fetch).mockResolvedValue(upcomingResponse(payloads));

    render(<OfflineManifestAutoSave />);

    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledWith(
      "/api/offline-manifests/upcoming",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    // Exactly one request for the round. This caller wants the board *and* the
    // tenant, and gets both from the one response — the identity route
    // (review 20260802, action item 12) is for the offline shell, which wants
    // the tenant alone; calling it here would be a second round trip for a
    // string already in hand.
    expect(fetch).toHaveBeenCalledTimes(1);
    // The server-verified shop identity drives the purge — never a
    // client-supplied value (see ADR 20260726-shopwide-offline-manifest-priming).
    expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis", 1);
    expect(beginOfflineTenantVerificationRound).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginOfflineTenantVerificationRound).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0],
    );
    expect(
      vi.mocked(saveOfflineManifest).mock.calls.map((call) => call[0].manifests[0].trip.id),
    ).toEqual(["trip-1", "trip-2"]);
  });

  it("purges even when the window has zero trips, so a shop switch on an idle board still clears stale data", async () => {
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(upcomingResponse([]));

    render(<OfflineManifestAutoSave />);

    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis", 1),
    );
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });

  it("still primes the shell when the upcoming-manifests fetch itself fails", async () => {
    // Priming is cheap, data-free, and unrelated to the board fetch — a
    // device that's never primed before must still get a cached shell (and
    // so a root-path offline fallback) even on a round where the fetch has a
    // bad moment, rather than only priming on rounds the fetch happens to
    // succeed.
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));

    render(<OfflineManifestAutoSave />);

    await waitFor(() => expect(primeOfflineManifestShell).toHaveBeenCalled());
    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });

  it("never fetches while offline", async () => {
    setOnline(false);
    render(<OfflineManifestAutoSave />);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(primeOfflineManifestShell).not.toHaveBeenCalled();
    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();
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
    vi.mocked(fetch).mockResolvedValue(upcomingResponse(payloads));

    render(<OfflineManifestAutoSave />);

    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(2));
  });

  it("fails closed — never saves this shop's trips when the cross-shop purge itself fails", async () => {
    // Saving anyway would leave both shops' rosters readable side by side in
    // the device-wide list until the next successful purge — the opposite of
    // what the purge exists to guarantee.
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(purgeOfflineManifestsExceptShop).mockRejectedValue(new Error("indexeddb error"));
    vi.mocked(fetch).mockResolvedValue(upcomingResponse([payloadFor("trip-1")]));

    render(<OfflineManifestAutoSave />);

    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis", 1),
    );
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });

  // Security review, 2026-08-06. This round used to read the board with
  // `(await response.json()) as OfflineManifestUpcomingResponse` — an
  // assertion about a body nobody checked. A body of `{}` satisfies it, and
  // `body.shop.slug` then reads `undefined` without throwing on the way past,
  // so the device-wide delete pass got a slug matching no saved record, which
  // is to say every one of them. The store refuses that at its own chokepoint
  // now (see offline-manifest-store.test.ts, which proves nothing is deleted);
  // these prove this caller never produces it in the first place, and that a
  // malformed body costs the round rather than the device.
  it.each([
    ["carries no shop at all", { payloads: [] }],
    ["carries a shop with no slug", { shop: {}, payloads: [] }],
    ["carries an empty slug", { shop: { slug: "" }, payloads: [] }],
    ["is not an object at all", "gateway timeout"],
    ["is null", null],
  ])("purges nothing and saves nothing when the 200 body %s", async (_label, body) => {
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    render(<OfflineManifestAutoSave />);

    // Priming is the round's independent step and still runs, which is also
    // how we know the round actually got as far as reading the body rather
    // than failing earlier for some unrelated reason.
    await waitFor(() => expect(primeOfflineManifestShell).toHaveBeenCalled());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();
    // And nothing is written either: saving without a purge is the
    // cross-tenant residency the purge exists to prevent.
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });

  it("saves nothing, and does not throw, when a good body carries a malformed board", async () => {
    // `body.payloads.map(...)` on a body with no `payloads` threw outright,
    // which the outer catch swallowed — so the round died silently *after* the
    // purge. Parsed to an empty list instead: the tenant is known, the purge is
    // real, and there is simply nothing to write.
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ shop: { slug: "blue-mantis" } }), { status: 200 }),
    );

    render(<OfflineManifestAutoSave />);

    await waitFor(() =>
      expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis", 1),
    );
    expect(saveOfflineManifest).not.toHaveBeenCalled();
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

    first.resolve(upcomingResponse([]));
    await waitFor(() => expect(saveOfflineManifest).not.toHaveBeenCalled());
  });

  it("wipes medical alert words another person saved before saving, and all of them when the body names nobody (H-20261023-medical-alert-for-the)", async () => {
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(saveOfflineManifest).mockResolvedValue({} as never);
    vi.mocked(fetch).mockResolvedValue(
      upcomingResponse([payloadFor("trip-1")], { personId: "person-now" }),
    );
    const first = render(<OfflineManifestAutoSave />);
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(1));
    expect(wipeOfflineMedicalAlerts).toHaveBeenCalledWith("person-now", 1);
    expect(vi.mocked(wipeOfflineMedicalAlerts).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveOfflineManifest).mock.invocationCallOrder[0] ?? 0,
    );
    first.unmount();

    vi.mocked(fetch).mockResolvedValue(upcomingResponse([payloadFor("trip-1")]));
    render(<OfflineManifestAutoSave />);
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(2));
    expect(wipeOfflineMedicalAlerts).toHaveBeenLastCalledWith(undefined, 1);
  });

  it("tells each save whether this viewer may still hold that departure's words (security review 2, L3)", async () => {
    setOnline(true);
    vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
    vi.mocked(saveOfflineManifest).mockResolvedValue({} as never);
    vi.mocked(fetch).mockResolvedValue(
      upcomingResponse(
        [payloadFor("trip-1"), payloadFor("trip-2"), payloadFor("trip-3")],
        {
          personId: "person-now",
        },
        { "trip-1": true, "trip-2": false },
      ),
    );
    render(<OfflineManifestAutoSave />);
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(3));
    const keep = new Map(
      vi
        .mocked(saveOfflineManifest)
        .mock.calls.map(([payload, options]) => [
          payload.manifests[0]?.trip.id,
          options?.keepMedicalAlertWords,
        ]),
    );
    // Taken off the boat (false), or not named at all: the words go.
    expect(Object.fromEntries(keep)).toEqual({ "trip-1": true, "trip-2": false, "trip-3": false });
  });
});
