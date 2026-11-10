// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  platforms: vi.fn(),
  push: vi.fn(),
  checkIn: vi.fn(),
  flush: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/features/wallet-pass", () => ({
  configuredWalletPlatforms: mocks.platforms,
  pushChangedWalletPasses: mocks.push,
}));
vi.mock("@/features/sentry-server", () => ({ sentry: { captureCheckIn: mocks.checkIn } }));
vi.mock("@/features/log-shipping", () => ({ flushLogs: mocks.flush }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "wallet-test-cron");
  mocks.platforms.mockReturnValue(["apple"]);
  mocks.getDb.mockResolvedValue(mocks.db);
  mocks.checkIn.mockResolvedValue("test-check-in");
  mocks.push.mockResolvedValue({ examined: 2, pushed: 1, failed: 0 });
});
afterEach(() => vi.unstubAllEnvs());
const request = (token = "wallet-test-cron") =>
  new Request("https://test.invalid/api/cron/wallet-passes", {
    headers: { Authorization: `Bearer ${token}` },
  });

describe("the ten-minute native Wallet pass", () => {
  it("requires the cron credential before any read or Sentry check-in", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.checkIn).not.toHaveBeenCalled();
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(503);
  });
  it("does nothing while native platforms are dark", async () => {
    mocks.platforms.mockReturnValue([]);
    const response = await GET(request());
    expect(await response.json()).toEqual({ examined: 0, pushed: 0, failed: 0 });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });
  it("runs the bounded scan and completes its monitor", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith(mocks.db);
    expect(mocks.checkIn).toHaveBeenLastCalledWith({
      checkInId: "test-check-in",
      monitorSlug: "diveday-wallet-passes",
      status: "ok",
    });
    expect(mocks.flush).toHaveBeenCalledOnce();
  });
  it("marks a partial failed delivery as a failed run", async () => {
    mocks.push.mockResolvedValue({ examined: 2, pushed: 1, failed: 1 });
    expect((await GET(request())).status).toBe(500);
    expect(mocks.checkIn).toHaveBeenLastCalledWith({
      checkInId: "test-check-in",
      monitorSlug: "diveday-wallet-passes",
      status: "error",
    });
    expect(mocks.flush).toHaveBeenCalledOnce();
  });
  it("closes its monitor and returns a code without exposing a bootstrap error", async () => {
    mocks.getDb.mockRejectedValueOnce(new Error("private provider detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "wallet_unavailable" });
    expect(mocks.checkIn).toHaveBeenLastCalledWith({
      checkInId: "test-check-in",
      monitorSlug: "diveday-wallet-passes",
      status: "error",
    });
    expect(mocks.flush).toHaveBeenCalledOnce();
  });
});
