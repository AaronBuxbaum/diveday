import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../staff-context", () => ({
  authorizeOfflineManifestStaff: vi.fn(),
  OFFLINE_MANIFEST_NO_STORE: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/features/unresolved-roll-call", () => ({
  readUnresolvedRollCallObservation: vi.fn(),
  unresolvedReviewAvailable: vi.fn(() => true),
}));
vi.mock("@/features/same-origin", () => ({ isCrossSiteHeaders: vi.fn(() => false) }));
const { authorizeOfflineManifestStaff } = await import("../../../staff-context");
const { readUnresolvedRollCallObservation, unresolvedReviewAvailable } = await import(
  "@/features/unresolved-roll-call"
);
const { isCrossSiteHeaders } = await import("@/features/same-origin");
const { POST } = await import("./route");
const tripId = "75cc6f7a-1160-4ca0-887f-039d87235500";
const clientEventId = "e2e2dd7d-67f7-4bfd-8411-37da993080fe";
const args = { params: Promise.resolve({ tripId, clientEventId }) };
const request = () => new Request("http://localhost/review", { method: "POST" });
const mockAccess = vi.mocked(authorizeOfflineManifestStaff);
const mockRead = vi.mocked(readUnresolvedRollCallObservation);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCrossSiteHeaders).mockReturnValue(false);
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(true);
});

it("refuses a cross-site read before authentication or lookup", async () => {
  vi.mocked(isCrossSiteHeaders).mockReturnValue(true);
  expect((await POST(request(), args)).status).toBe(403);
  expect(mockAccess).not.toHaveBeenCalled();
  expect(mockRead).not.toHaveBeenCalled();
});

it("returns the authentication refusal without querying observations", async () => {
  mockAccess.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
  expect((await POST(request(), args)).status).toBe(401);
  expect(mockRead).not.toHaveBeenCalled();
});

it("uses the session identity, returns private no-store, and makes no receipt", async () => {
  const db = {} as never;
  mockAccess.mockResolvedValue({
    ok: true,
    db,
    shop: { id: "session-shop" },
    user: { personId: "session-staff", sessionId: clientEventId },
  } as never);
  mockRead.mockResolvedValue({
    ok: true,
    claim: { observation: { status: "not_boarded" } },
  } as never);
  const response = await POST(request(), args);
  expect(mockRead).toHaveBeenCalledWith(db, {
    shopId: "session-shop",
    staffPersonId: "session-staff",
    sessionId: clientEventId,
    tripId,
    clientEventId,
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ claim: { observation: { status: "not_boarded" } } });
});

it("refuses malformed ids and respects a fresh authorization refusal", async () => {
  mockAccess.mockResolvedValue({
    ok: true,
    db: {} as never,
    shop: { id: "shop" },
    user: { personId: "staff", sessionId: clientEventId },
  } as never);
  expect(
    (await POST(request(), { params: Promise.resolve({ tripId: "bad", clientEventId }) })).status,
  ).toBe(404);
  expect(mockRead).not.toHaveBeenCalled();
  mockRead.mockResolvedValue({ ok: false, reason: "forbidden" });
  expect((await POST(request(), args)).status).toBe(403);
});

it("keeps review unavailable before the lifecycle and receipt are verified", async () => {
  mockAccess.mockResolvedValue({
    ok: true,
    db: {} as never,
    shop: { id: "shop" },
    user: { personId: "staff", sessionId: clientEventId },
  } as never);
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(false);
  const response = await POST(request(), args);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "review_unavailable" });
  expect(mockRead).not.toHaveBeenCalled();
});

it("reports an unreadable stored observation without claiming it was resolved", async () => {
  mockAccess.mockResolvedValue({
    ok: true,
    db: {} as never,
    shop: { id: "shop" },
    user: { personId: "staff", sessionId: clientEventId },
  } as never);
  mockRead.mockResolvedValue({ ok: false, reason: "observation_unreadable" });
  const response = await POST(request(), args);
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "observation_unreadable" });
});
