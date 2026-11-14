import { beforeEach, expect, it, vi } from "vitest";
import { signRosterConfirmation } from "@/features/offline-manifest-snapshots";

vi.mock("@/app/api/offline-manifests/staff-context", () => ({
  authorizeOfflineManifestStaff: vi.fn(),
  OFFLINE_MANIFEST_NO_STORE: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/db/shops", () => ({ getShopOfflineErasureEpoch: vi.fn() }));
const { getShopOfflineErasureEpoch } = await import("@/db/shops");
const { authorizeOfflineManifestStaff } = await import("@/app/api/offline-manifests/staff-context");
const { POST } = await import("./route");
const tripId = "11111111-1111-4111-8111-111111111111";
const nonce = "22222222-2222-4222-8222-222222222222";
const renderId = "33333333-3333-4333-8333-333333333333";
const readCompletedAt = 1_794_581_040_000;
const sessionId = "session-one";
const shopId = "shop-one";
const proof = signRosterConfirmation({
  tripId,
  shopId,
  sessionId,
  nonce,
  renderId,
  erasureEpoch: 4,
  checkpoint: "departure",
  readCompletedAt,
});
const params = Promise.resolve({ tripId });
const request = (value: unknown) =>
  new Request("http://localhost/api/offline-manifests/test/roster-confirmation", {
    method: "POST",
    body: JSON.stringify({ checkpoint: "departure", readCompletedAt, ...(value as object) }),
  });

beforeEach(() => {
  vi.mocked(getShopOfflineErasureEpoch).mockResolvedValue(4);
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValue({
    ok: true,
    shop: { id: shopId },
    user: { sessionId },
  } as never);
});

it("refuses a rendered roster if an erasure occurred before confirmation", async () => {
  vi.mocked(getShopOfflineErasureEpoch).mockResolvedValue(5);
  expect((await POST(request({ nonce, proof, renderId }), { params })).status).toBe(403);
  vi.mocked(getShopOfflineErasureEpoch).mockResolvedValue(null);
  expect((await POST(request({ nonce, proof, renderId }), { params })).status).toBe(403);
});

it("confirms only a binding for the live authorized session", async () => {
  expect(proof).toBeTruthy();
  const response = await POST(request({ nonce, proof, renderId }), { params });
  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe("");
});

it("refuses a valid proof for a different or missing checkpoint", async () => {
  expect(
    (await POST(request({ nonce, proof, renderId, checkpoint: "after_dive_1" }), { params }))
      .status,
  ).toBe(403);
  expect(
    (await POST(request({ nonce, proof, renderId, checkpoint: null }), { params })).status,
  ).toBe(403);
});

it.each(["after_dive_1", "after_dive_5"])(
  "accepts a live proof for %s only at that checkpoint",
  async (checkpoint) => {
    const diveProof = signRosterConfirmation({
      tripId,
      shopId,
      sessionId,
      nonce,
      renderId,
      erasureEpoch: 4,
      checkpoint,
      readCompletedAt,
    });
    expect(diveProof).toBeTruthy();
    expect(
      (await POST(request({ nonce, proof: diveProof, renderId, checkpoint }), { params })).status,
    ).toBe(204);
    expect(
      (
        await POST(request({ nonce, proof: diveProof, renderId, checkpoint: "departure" }), {
          params,
        })
      ).status,
    ).toBe(403);
  },
);

it("refuses a different or absent completed read time", async () => {
  expect(
    (
      await POST(request({ nonce, proof, renderId, readCompletedAt: readCompletedAt + 1 }), {
        params,
      })
    ).status,
  ).toBe(403);
  expect(
    (await POST(request({ nonce, proof, renderId, readCompletedAt: null }), { params })).status,
  ).toBe(403);
});

it("refuses a different session in the same shop", async () => {
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValue({
    ok: true,
    shop: { id: shopId },
    user: { sessionId: "session-two" },
  } as never);
  expect((await POST(request({ nonce, proof, renderId }), { params })).status).toBe(403);
});

it("does not accept an old proof after session revocation", async () => {
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValue({
    ok: false,
    response: new Response(null, { status: 401 }),
  } as never);
  expect((await POST(request({ nonce, proof, renderId }), { params })).status).toBe(401);
});

it("refuses tampered challenges and missing session identity", async () => {
  expect((await POST(request({ nonce: "invalid", proof, renderId }), { params })).status).toBe(403);
  expect(
    (
      await POST(request({ nonce, proof, renderId: "44444444-4444-4444-8444-444444444444" }), {
        params,
      })
    ).status,
  ).toBe(403);
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValue({
    ok: true,
    shop: { id: shopId },
    user: {},
  } as never);
  expect((await POST(request({ nonce, proof, renderId }), { params })).status).toBe(403);
});

it("refuses an oversized streaming confirmation before consuming the rest of its body", async () => {
  let cancelled = false;
  let chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks += 1;
      if (chunks > 2) controller.close();
      else controller.enqueue(new Uint8Array(1_025));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streaming = new Request("http://localhost/api/offline-manifests/test/roster-confirmation", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect((await POST(streaming, { params })).status).toBe(413);
  expect(cancelled).toBe(true);
});
