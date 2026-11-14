import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../staff-context", () => ({
  authorizeOfflineManifestStaff: vi.fn(),
  OFFLINE_MANIFEST_NO_STORE: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/features/unresolved-roll-call", () => ({
  listRetainedSafetyReviewEntries: vi.fn(),
  unresolvedReviewAvailable: vi.fn(() => true),
}));
vi.mock("@/features/same-origin", () => ({ isCrossSiteHeaders: vi.fn(() => false) }));
const { authorizeOfflineManifestStaff } = await import("../../staff-context");
const { listRetainedSafetyReviewEntries, unresolvedReviewAvailable } = await import(
  "@/features/unresolved-roll-call"
);
const { isCrossSiteHeaders } = await import("@/features/same-origin");
const { POST } = await import("./route");
const tripId = "75cc6f7a-1160-4ca0-887f-039d87235500";
const cursor = "e2e2dd7d-67f7-4bfd-8411-37da993080fe";
const frontier = "a".repeat(64);
const args = { params: Promise.resolve({ tripId }) };
const request = (body: unknown = {}) =>
  new Request("http://localhost/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const access = vi.mocked(authorizeOfflineManifestStaff);
const list = vi.mocked(listRetainedSafetyReviewEntries);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCrossSiteHeaders).mockReturnValue(false);
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(true);
  access.mockResolvedValue({
    ok: true,
    db: {},
    shop: { id: "session-shop" },
    user: { personId: "session-person", sessionId: cursor },
  } as never);
});

it("rejects cross-site, unavailable review, and malformed cursor without listing", async () => {
  vi.mocked(isCrossSiteHeaders).mockReturnValue(true);
  expect((await POST(request(), args)).status).toBe(403);
  expect(access).not.toHaveBeenCalled();
  vi.mocked(isCrossSiteHeaders).mockReturnValue(false);
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(false);
  expect((await POST(request(), args)).status).toBe(503);
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(true);
  expect((await POST(request({ cursor: { bad: true } }), args)).status).toBe(400);
  expect((await POST(request({ cursor }), args)).status).toBe(400);
  expect((await POST(request({ padding: "x".repeat(1025) }), args)).status).toBe(413);
  expect(list).not.toHaveBeenCalled();
});

it("uses authenticated scope, preserves the cursor and returns private no-store", async () => {
  list.mockResolvedValue({
    ok: true,
    entries: [{ clientEventId: null }],
    nextCursor: cursor,
    frontier,
  });
  const response = await POST(request({ cursor, frontier, shopId: "other-shop" }), args);
  expect(list).toHaveBeenCalledWith(
    {},
    {
      shopId: "session-shop",
      staffPersonId: "session-person",
      sessionId: cursor,
      tripId,
      cursor,
      frontier,
    },
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    entries: [{ clientEventId: null }],
    nextCursor: cursor,
    frontier,
  });
});

it("does not turn a live role refusal into a review result", async () => {
  list.mockResolvedValue({ ok: false, reason: "forbidden" });
  const response = await POST(request(), args);
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("requires a restart if the review frontier changed", async () => {
  list.mockResolvedValue({ ok: false, reason: "review_changed" });
  const response = await POST(request({ cursor, frontier }), args);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "review_changed" });
});

it("requires an actual session identifier before listing", async () => {
  access.mockResolvedValue({
    ok: true,
    db: {},
    shop: { id: "session-shop" },
    user: { personId: "session-person" },
  } as never);
  const response = await POST(request(), args);
  expect(response.status).toBe(401);
  expect(list).not.toHaveBeenCalled();
});
