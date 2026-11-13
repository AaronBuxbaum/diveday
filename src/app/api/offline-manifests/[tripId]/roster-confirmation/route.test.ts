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
const sessionId = "session-one";
const shopId = "shop-one";
const proof = signRosterConfirmation({
  tripId,
  shopId,
  sessionId,
  nonce,
  renderId,
  erasureEpoch: 4,
});
const params = Promise.resolve({ tripId });
const request = (value: unknown) =>
  new Request("http://localhost/api/offline-manifests/test/roster-confirmation", {
    method: "POST",
    body: JSON.stringify(value),
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
