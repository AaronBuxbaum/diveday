import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("./dispatcher", () => ({ dispatchDueIntegrationDeliveries: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));

const { after } = await import("next/server");
const { getDb } = await import("@/db/client");
const { dispatchDueIntegrationDeliveries } = await import("./dispatcher");
const { log } = await import("@/lib/log");
const { dispatchIntegrationsAfterResponse, WRITE_PATH_DISPATCH_LIMIT } = await import(
  "./dispatch-on-write"
);

const FAKE_DB = { fake: "db" };
const NOTHING_DUE = { scanned: 0, delivered: 0, retried: 0, failed: 0 };

/** Run whatever the helper handed to `after`, the way the platform would. */
async function runScheduledWork() {
  const callback = vi.mocked(after).mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
  expect(callback).toBeTypeOf("function");
  await callback?.();
}

beforeEach(() => {
  vi.mocked(after)
    .mockReset()
    .mockImplementation(() => {});
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(dispatchDueIntegrationDeliveries).mockReset().mockResolvedValue(NOTHING_DUE);
  vi.mocked(log).mockReset();
});

describe("dispatchIntegrationsAfterResponse", () => {
  it("schedules the drain rather than running it inline", () => {
    dispatchIntegrationsAfterResponse();

    // Nothing has touched the database yet: the caller's response is not
    // waiting on a third-party HTTP round trip.
    expect(after).toHaveBeenCalledTimes(1);
    expect(dispatchDueIntegrationDeliveries).not.toHaveBeenCalled();
  });

  /**
   * Both arguments carry weight, and the second is the one that was wrong
   * first: with the dispatcher's default `oldest-first`, a shop already
   * holding `WRITE_PATH_DISPATCH_LIMIT` waiting deliveries drained those and
   * left the order just written for the cron (`sourcery-ai` on #1905). The
   * ordering is exercised for real against the database in
   * `dispatcher.test.ts`; here it is pinned as the request the write path
   * makes.
   */
  it("drains the newest end, with the write-path limit rather than the cron's", async () => {
    dispatchIntegrationsAfterResponse();
    await runScheduledWork();

    expect(dispatchDueIntegrationDeliveries).toHaveBeenCalledWith(FAKE_DB, {
      limit: WRITE_PATH_DISPATCH_LIMIT,
      order: "newest-first",
    });
    // A request drains what it just wrote, not somebody else's backlog.
    expect(WRITE_PATH_DISPATCH_LIMIT).toBeLessThan(50);
  });

  it("stays silent when nothing was due", async () => {
    dispatchIntegrationsAfterResponse();
    await runScheduledWork();

    // The common case on a shop with no integration connected. A log line per
    // order for an empty read is noise that would outnumber the real ones.
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a summary when it actually delivered something", async () => {
    const summary = { scanned: 2, delivered: 2, retried: 0, failed: 0 };
    vi.mocked(dispatchDueIntegrationDeliveries).mockResolvedValue(summary);

    dispatchIntegrationsAfterResponse();
    await runScheduledWork();

    expect(log).toHaveBeenCalledWith("integrations.dispatch_after_response", "info", summary);
  });

  /**
   * The order is already written and committed when this runs. A provider
   * being down, or the database being unreachable in the after-phase, must
   * never turn a completed sale into a failed action — and it cannot lose the
   * delivery either, because the row outlives the request and the cron drains
   * it next.
   */
  it("never lets a failing drain escape into the caller", async () => {
    vi.mocked(dispatchDueIntegrationDeliveries).mockRejectedValue(new Error("provider down"));

    dispatchIntegrationsAfterResponse();
    await expect(runScheduledWork()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("integrations.dispatch_after_response_failed", "error", {});
  });

  it("survives being called with no request scope to attach to", () => {
    vi.mocked(after).mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });

    expect(() => dispatchIntegrationsAfterResponse()).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      "integrations.dispatch_after_response_unscheduled",
      "warn",
      {},
    );
  });
});

/**
 * The drain is only as good as its call sites, and a new order path that
 * forgets it fails silently — the event still delivers, just up to half an hour
 * late, which no test would otherwise notice.
 *
 * Every entry below is an app-layer file that reaches a write which enqueues an
 * integration event: `createOrder` (`order.created`), and `applyOrderUpdate`
 * via `markOrderPaidByInvoiceId`, `refundOrder` and `refreshOrderStatus`
 * (`order.paid` / `order.refunded`). `voidOrder` is deliberately absent — a
 * void writes no event.
 */
describe("the write paths that enqueue integration events", () => {
  const ENTRY_POINTS = [
    "src/app/shop/[shopSlug]/orders/new/actions.ts",
    "src/app/shop/[shopSlug]/orders/[id]/page.tsx",
    "src/app/api/webhooks/stripe/route.ts",
  ];

  it.each(ENTRY_POINTS)("%s drains the outbox after its response", (entryPoint) => {
    const source = readFileSync(path.join(process.cwd(), entryPoint), "utf8");
    expect(source).toContain("dispatchIntegrationsAfterResponse");
  });
});
