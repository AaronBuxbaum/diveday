import { beforeEach, expect, it, vi } from "vitest";
import {
  liveManifestSessionHandle,
  verifyLiveManifestRecovery,
} from "@/features/live-manifest-server";
import { nowMs } from "@/lib/clock";

vi.mock("@/app/api/offline-manifests/staff-context", () => ({
  authorizeOfflineManifestStaff: vi.fn(),
  OFFLINE_MANIFEST_NO_STORE: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/db/shops", () => ({ getShopOfflineErasureEpoch: vi.fn() }));
const { authorizeOfflineManifestStaff } = await import("@/app/api/offline-manifests/staff-context");
const { getShopOfflineErasureEpoch } = await import("@/db/shops");
const { POST } = await import("./route");
const challenge = {
  tombstone: "11111111-1111-4111-8111-111111111111",
  nonce: "22222222-2222-4222-8222-222222222222",
};
const shopId = "shop-one";
const sessionId = "sensitive-session-one";
const request = (body: string, headers?: Record<string, string>) =>
  new Request("http://localhost/api/offline-manifests/recovery", { method: "POST", headers, body });

beforeEach(() => {
  vi.mocked(getShopOfflineErasureEpoch).mockResolvedValue(7);
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValue({
    ok: true,
    db: {},
    shop: { id: shopId },
    user: { sessionId },
  } as never);
});

it("returns a no-store recovery observation bound to the live session and challenge", async () => {
  const response = await POST(request(JSON.stringify(challenge)));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const raw = await response.text();
  expect(raw).not.toContain(sessionId);
  const body = JSON.parse(raw);
  expect(body.shopId).toBe(shopId);
  expect(body.sessionHandle).toBe(liveManifestSessionHandle(shopId, sessionId));
  expect(body.erasureEpoch).toBe(7);
  expect(body.tombstone).toBe(challenge.tombstone);
  expect(body.nonce).toBe(challenge.nonce);
  expect(verifyLiveManifestRecovery(body, body.proof, nowMs())).toBe(true);
  expect(verifyLiveManifestRecovery({ ...body, erasureEpoch: 8 }, body.proof, nowMs())).toBe(false);
  expect(
    verifyLiveManifestRecovery({ ...body, sessionHandle: "a".repeat(43) }, body.proof, nowMs()),
  ).toBe(false);
});

it("refuses cross-site, malformed and oversized challenges", async () => {
  expect(
    (await POST(request(JSON.stringify(challenge), { "sec-fetch-site": "cross-site" }))).status,
  ).toBe(403);
  expect((await POST(request("not-json"))).status).toBe(400);
  expect((await POST(request(JSON.stringify({ ...challenge, nonce: "invalid" })))).status).toBe(
    400,
  );
  expect((await POST(request("x".repeat(1100)))).status).toBe(413);
});

it("fails closed for revoked sessions and unavailable epoch", async () => {
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValueOnce({
    ok: false,
    response: new Response(null, { status: 401 }),
  } as never);
  expect((await POST(request(JSON.stringify(challenge)))).status).toBe(401);
  vi.mocked(getShopOfflineErasureEpoch).mockResolvedValueOnce(null);
  expect((await POST(request(JSON.stringify(challenge)))).status).toBe(503);
});

it("bounds a request body that never finishes", async () => {
  vi.useFakeTimers();
  try {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const stalled = new Request("http://localhost/api/offline-manifests/recovery", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const pending = POST(stalled);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe(408);
  } finally {
    vi.useRealTimers();
  }
});
