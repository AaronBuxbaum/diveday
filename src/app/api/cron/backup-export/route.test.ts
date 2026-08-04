import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/features/backup-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/backup-export")>();
  return { ...actual, listShopsDueForBackup: vi.fn(), runShopBackup: vi.fn() };
});
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { listShopsDueForBackup, runShopBackup } = await import("@/features/backup-export");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/backup-export", { headers });
}

function dueShop(slug: string) {
  return {
    destination: { shopId: `shop-${slug}` },
    shopSlug: slug,
    shopName: slug,
    shopLocale: "en-US",
  };
}

function summaryLine(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0]?.[0] as string);
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(listShopsDueForBackup)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(runShopBackup)
    .mockReset()
    .mockResolvedValue({
      status: "delivered",
      deliveryId: "d1",
      objectKey: "k.zip",
      byteCount: 1,
    } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Same fail-closed posture as the other crons: this route reads the whole
// shop's data and sends it to an owner-configured URL, so an unconfigured or
// unauthenticated deployment must upload nothing at all.
describe("GET /api/cron/backup-export — auth gate", () => {
  it("is unavailable when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(runShopBackup).not.toHaveBeenCalled();
  });

  it("rejects a request without the bearer token", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(runShopBackup).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(runShopBackup).not.toHaveBeenCalled();
  });

  it("never checks in for an unauthorized probe", async () => {
    await GET(cronRequest("Bearer wrong"));
    vi.stubEnv("CRON_SECRET", "");
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/backup-export — the weekly pass", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("runs a scheduled backup for every due shop and reports a clean pass", async () => {
    vi.mocked(listShopsDueForBackup).mockResolvedValue([
      dueShop("blue-mantis"),
      dueShop("coral-reef"),
    ] as never);

    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      shopsDue: 2,
      delivered: 2,
      failed: 0,
    });

    expect(runShopBackup).toHaveBeenCalledTimes(2);
    expect(runShopBackup).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ shopId: "shop-blue-mantis", trigger: "scheduled" }),
    );
    // The ride-along calendar labels arrive resolved, not as keys.
    const input = vi.mocked(runShopBackup).mock.calls[0]?.[1] as {
      icsLabels: { calendarName: string; day: (n: number) => string };
    };
    expect(input.icsLabels.calendarName).toContain("blue-mantis");
    expect(input.icsLabels.day(2)).toMatch(/2/);

    expect(summaryLine()).toEqual(
      expect.objectContaining({
        event: "cron_backup_export.pass_complete",
        delivered: 2,
        failed: 0,
      }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  it("keeps going past a failing shop, reports 500, and names the failure by code", async () => {
    vi.mocked(listShopsDueForBackup).mockResolvedValue([
      dueShop("broken-bucket"),
      dueShop("fine-shop"),
    ] as never);
    vi.mocked(runShopBackup)
      .mockResolvedValueOnce({
        status: "failed",
        errorCode: "upload_unauthorized",
        deliveryId: "d-fail",
      } as never)
      .mockResolvedValueOnce({
        status: "delivered",
        deliveryId: "d-ok",
        objectKey: "k.zip",
        byteCount: 9,
      } as never);

    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      delivered: 1,
      failed: 1,
      outcomes: [
        { shop: "broken-bucket", status: "failed", errorCode: "upload_unauthorized" },
        { shop: "fine-shop", status: "delivered" },
      ],
    });

    // The second shop still ran — one broken destination never blocks the rest.
    expect(runShopBackup).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "backup export delivery failed",
      expect.objectContaining({
        tags: expect.objectContaining({ backup_error: "upload_unauthorized" }),
      }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(summaryLine()).toEqual(
      expect.objectContaining({ failed: 1, failedShops: "broken-bucket" }),
    );
  });

  it("treats an already-delivered week as a clean no-op, not a failure", async () => {
    vi.mocked(listShopsDueForBackup).mockResolvedValue([dueShop("blue-mantis")] as never);
    vi.mocked(runShopBackup).mockResolvedValue({
      status: "skipped_already_delivered",
      periodKey: "2026-W32",
    } as never);

    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ delivered: 0, failed: 0 });
  });

  it("still emits a summary line when no shop is due", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(summaryLine()).toEqual(
      expect.objectContaining({ event: "cron_backup_export.pass_complete", shopsDue: 0 }),
    );
  });

  it("closes the check-in as error when the pass cannot even start", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("no database"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});
