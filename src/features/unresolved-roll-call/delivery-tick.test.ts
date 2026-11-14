import { beforeEach, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { nowDate } from "@/lib/clock";

vi.mock("./delivery-monitor", () => ({ readSafetyDeliveryMonitor: vi.fn() }));
vi.mock("./delivery-scan", () => ({ scanUnresolvedSafetyAlerts: vi.fn() }));
vi.mock("./review-availability", () => ({ unresolvedReviewAvailable: vi.fn(() => false) }));
vi.mock("@/features/sentry-server", () => ({ sentry: { captureException: vi.fn() } }));
const { readSafetyDeliveryMonitor } = await import("./delivery-monitor");
const { scanUnresolvedSafetyAlerts } = await import("./delivery-scan");
const { runUnresolvedSafetyAlertTick } = await import("./delivery-tick");
const { unresolvedReviewAvailable } = await import("./review-availability");
const { runShopTick, shopTickIsHealthy } = await import("@/features/shop-tick");
const db = {} as AppDb;

beforeEach(() => vi.mocked(unresolvedReviewAvailable).mockReturnValue(false));

it("keeps the scheduled scan disabled without touching the database", async () => {
  const summary = await runShopTick(db, nowDate(), ["unresolved-safety-alerts"]);
  expect(summary).toEqual({ "unresolved-safety-alerts": { status: "disabled" } });
  expect(shopTickIsHealthy(summary)).toBe(true);
});

it("marks the scheduled tick unhealthy if review is enabled without a verified adapter", async () => {
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(true);
  const summary = await runShopTick(db, nowDate(), ["unresolved-safety-alerts"]);
  expect(summary).toEqual({ "unresolved-safety-alerts": null });
  expect(shopTickIsHealthy(summary)).toBe(false);
});

it("dispatches an enabled tick only with an approved provider and reports scanner failures", async () => {
  vi.mocked(unresolvedReviewAvailable).mockReturnValue(true);
  const provider = { safetySingleAttemptAbortable: true, send: vi.fn() } as never;
  vi.mocked(scanUnresolvedSafetyAlerts).mockResolvedValueOnce({
    status: "scanned",
    scanned: 2,
    cycleFinished: true,
  });
  vi.mocked(readSafetyDeliveryMonitor).mockResolvedValueOnce({ needsAttention: true } as never);
  const result = await runUnresolvedSafetyAlertTick(db, provider);
  expect(result).toMatchObject({
    status: "scanned",
    scanned: 2,
    cycleFinished: true,
    monitoring: { needsAttention: true },
  });
  expect(shopTickIsHealthy({ "unresolved-safety-alerts": result })).toBe(false);
  expect(scanUnresolvedSafetyAlerts).toHaveBeenCalledWith(db, provider);
  vi.mocked(scanUnresolvedSafetyAlerts).mockResolvedValueOnce({ status: "lost_lease", scanned: 1 });
  await expect(runUnresolvedSafetyAlertTick(db, provider)).rejects.toThrow("lost_lease");
});
