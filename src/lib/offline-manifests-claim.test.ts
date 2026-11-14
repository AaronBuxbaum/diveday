// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  claimOfflineManifestSnapshot,
  fetchOfflineManifestShopSlug,
  OFFLINE_MANIFEST_STALE_READ,
  type OfflineManifestPayload,
} from "./offline-manifests";
import { ROLL_CALL_CAUSAL_PROTOCOL, ROLL_CALL_CAUSAL_PROTOCOL_HEADER } from "./roll-call-protocol";

const issued = {
  snapshotId: "10000000-0000-4000-8000-000000000001",
  erasureEpochToken: `4.8.${"a".repeat(43)}`,
  meetingIdentityProofs: [],
};
function pagePayload(): OfflineManifestPayload {
  return { ...snapshot(), readAt: { erasureEpoch: 4, snapshotRevision: 7, scheduleVersion: "[]" } };
}
function radio(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("claims the displayed read under the causal protocol without posting roster data or changing its payload", async () => {
  radio(true);
  const payload = pagePayload(),
    original = structuredClone(payload);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(issued));
  vi.stubGlobal("fetch", fetcher);
  const claimed = await claimOfflineManifestSnapshot(payload);
  const { readAt: _readAt, ...preserved } = original;
  expect(claimed).toEqual({
    ...preserved,
    snapshotId: issued.snapshotId,
    erasureEpochToken: issued.erasureEpochToken,
  });
  expect(claimed).not.toHaveProperty("readAt");
  expect(payload).toEqual(original);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("/api/offline-manifests/trip-1/snapshot");
  expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
  expect(new Headers(init?.headers).get(ROLL_CALL_CAUSAL_PROTOCOL_HEADER)).toBe(
    ROLL_CALL_CAUSAL_PROTOCOL,
  );
  expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  expect(JSON.parse(String(init?.body))).toEqual({
    erasureEpoch: 4,
    snapshotRevision: 7,
    scheduleVersion: "[]",
  });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init?.signal?.aborted).toBe(false);
});

it("keeps an already issued copy usable offline without claiming a different snapshot", async () => {
  radio(false);
  const payload = { ...snapshot(), ...issued };
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  expect(await claimOfflineManifestSnapshot(payload)).toBe(payload);
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not claim a page read while the radio is offline", async () => {
  radio(false);
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  expect(await claimOfflineManifestSnapshot(pagePayload())).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not issue a claim for a payload that names no departure", async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  expect(await claimOfflineManifestSnapshot({ ...pagePayload(), manifests: [] })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it("returns stale-read on409 even when the refusal body cannot be parsed, leaving the displayed payload unchanged", async () => {
  const payload = pagePayload(),
    original = structuredClone(payload);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 409 })),
  );
  expect(await claimOfflineManifestSnapshot(payload)).toBe(OFFLINE_MANIFEST_STALE_READ);
  expect(payload).toEqual(original);
});

for (const body of [
  null,
  false,
  "issued",
  {},
  { snapshotId: 42, erasureEpochToken: issued.erasureEpochToken },
  { snapshotId: issued.snapshotId, erasureEpochToken: 42 },
]) {
  it(`does not turn an unrecognized claim response into a saved copy: ${JSON.stringify(body)}`, async () => {
    const payload = pagePayload(),
      original = structuredClone(payload);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    expect(await claimOfflineManifestSnapshot(payload)).toBeNull();
    expect(payload).toEqual(original);
  });
}

for (const status of [401, 426, 503]) {
  it(`leaves a page unclaimed after HTTP${status}`, async () => {
    const payload = pagePayload(),
      original = structuredClone(payload);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status })),
    );
    expect(await claimOfflineManifestSnapshot(payload)).toBeNull();
    expect(payload).toEqual(original);
  });
}

it("does not claim from a broken successful body or a rejected transport", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("not-json"))
    .mockRejectedValueOnce(new TypeError("network unavailable"));
  vi.stubGlobal("fetch", fetcher);
  const payload = pagePayload(),
    original = structuredClone(payload);
  expect(await claimOfflineManifestSnapshot(payload)).toBeNull();
  expect(await claimOfflineManifestSnapshot(payload)).toBeNull();
  expect(payload).toEqual(original);
});

it("verifies only the authenticated shop through the identity endpoint", async () => {
  radio(true);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ shop: { slug: "reef-runners" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchOfflineManifestShopSlug()).toBe("reef-runners");
  expect(fetcher).toHaveBeenCalledWith("/api/offline-manifests/identity", {
    credentials: "same-origin",
    signal: expect.any(AbortSignal),
  });
});

it("does not infer a signed-in shop while offline or from an unsuccessful response", async () => {
  radio(false);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchOfflineManifestShopSlug()).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  radio(true);
  expect(await fetchOfflineManifestShopSlug()).toBeNull();
});

for (const body of [null, {}, { shop: null }, { shop: { slug: "" } }, { shop: { slug: 42 } }]) {
  it(`does not guess a tenant from malformed identity data: ${JSON.stringify(body)}`, async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    expect(await fetchOfflineManifestShopSlug()).toBeNull();
  });
}

it("does not infer a tenant after a broken body or network failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not-json"))
      .mockRejectedValueOnce(new TypeError("network unavailable")),
  );
  expect(await fetchOfflineManifestShopSlug()).toBeNull();
  expect(await fetchOfflineManifestShopSlug()).toBeNull();
});

for (const action of ["identity", "claim"] as const) {
  it(`abandons an unanswered ${action} request at the existing 10 second deadline without inventing a result`, async () => {
    radio(true);
    vi.useFakeTimers();
    const request: { signal?: AbortSignal | null } = {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      request.signal = init?.signal;
      return new Promise<Response>((_resolve, reject) =>
        request.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          {
            once: true,
          },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const result =
      action === "identity"
        ? fetchOfflineManifestShopSlug()
        : claimOfflineManifestSnapshot(pagePayload());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBeNull();
    expect(request.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
}

it("withdraws freshness at the 409 headers without waiting for its body", async () => {
  const onStale = vi.fn();
  const body = new ReadableStream({ start() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 409 })),
  );
  expect(await claimOfflineManifestSnapshot(pagePayload(), { onStale })).toBe(
    OFFLINE_MANIFEST_STALE_READ,
  );
  expect(onStale).toHaveBeenCalledOnce();
});
