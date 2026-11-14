import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../../staff-context", () => ({
  authorizeOfflineManifestStaff: vi.fn(),
  OFFLINE_MANIFEST_NO_STORE: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/features/same-origin", () => ({ isCrossSiteHeaders: vi.fn(() => false) }));
vi.mock("@/features/unresolved-roll-call", () => ({
  deferUnresolvedReview: vi.fn(),
  unresolvedReviewAvailable: vi.fn(() => false),
  unresolvedDeferralAvailable: vi.fn(() => false),
}));
const { authorizeOfflineManifestStaff } = await import("../../../../staff-context");
const { isCrossSiteHeaders } = await import("@/features/same-origin");
const { deferUnresolvedReview, unresolvedDeferralAvailable, unresolvedReviewAvailable } =
  await import("@/features/unresolved-roll-call");
const { POST } = await import("./route");
const id = "8b96bd08-79e0-4e61-912d-1521d040ee13";
const args = { params: Promise.resolve({ tripId: id, clientEventId: id }) };
const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/defer", { method: "POST", headers });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCrossSiteHeaders).mockReturnValue(false);
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(false);
  vi.mocked(unresolvedDeferralAvailable).mockReturnValue(false);
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValue({
    ok: true,
    db: {} as never,
    shop: { id },
    user: { personId: id, sessionId: id },
  } as never);
});

it("keeps deferral disabled even for a signed-in staff member", async () => {
  const response = await POST(request(), args);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(deferUnresolvedReview).not.toHaveBeenCalled();
});

it("refuses cross-site and malformed requests and uses server session identity", async () => {
  vi.mocked(isCrossSiteHeaders).mockReturnValueOnce(true);
  expect((await POST(request(), args)).status).toBe(403);
  expect(authorizeOfflineManifestStaff).not.toHaveBeenCalled();
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(true);
  vi.mocked(unresolvedDeferralAvailable).mockReturnValue(true);
  expect((await POST(request(), args)).status).toBe(400);
  vi.mocked(deferUnresolvedReview).mockResolvedValue({
    ok: true,
    deferred: true,
    duplicate: false,
  });
  const response = await POST(
    request({ "x-review-revision": id, "x-review-request-id": id }),
    args,
  );
  expect(response.status).toBe(200);
  expect(deferUnresolvedReview).toHaveBeenCalledWith(expect.anything(), {
    shopId: id,
    staffPersonId: id,
    sessionId: id,
    tripId: id,
    clientEventId: id,
    reviewRevision: id,
    requestId: id,
  });
  expect(await response.json()).toEqual({ deferred: true, duplicate: false });
});

it("returns conflict when the displayed observation changed", async () => {
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(true);
  vi.mocked(unresolvedDeferralAvailable).mockReturnValue(true);
  vi.mocked(deferUnresolvedReview).mockResolvedValue({ ok: false, reason: "review_changed" });
  const response = await POST(
    request({ "x-review-revision": id, "x-review-request-id": id }),
    args,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "review_changed" });
});
