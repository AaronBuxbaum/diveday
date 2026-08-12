import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/features/backup-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/backup-export")>();
  return { ...actual, listShopsForPlatformBackup: vi.fn(), runPlatformBackup: vi.fn() };
});
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { listShopsForPlatformBackup, runPlatformBackup } = await import("@/features/backup-export");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/platform-backup", { headers });
}

function shop(slug: string) {
  return { id: `shop-${slug}`, slug, locale: "en-US" };
}

function logLines(): Record<string, unknown>[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>);
}

function configureUploader() {
  vi.stubEnv("PLATFORM_BACKUP_AWS_ACCESS_KEY_ID", "AKIA-TEST");
  vi.stubEnv("PLATFORM_BACKUP_AWS_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("PLATFORM_BACKUP_BUCKET", "diveday-backups");
  vi.stubEnv("PLATFORM_BACKUP_AWS_REGION", "us-east-1");
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  configureUploader();
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(listShopsForPlatformBackup)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(runPlatformBackup)
    .mockReset()
    .mockResolvedValue({ status: "stored", objectKey: "k.zip", byteCount: 1 } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Same fail-closed posture as every other cron: this route reads every shop's
// data, so an unconfigured or unauthenticated deployment must store nothing.
describe("GET /api/cron/platform-backup — auth gate", () => {
  it("is unavailable when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(runPlatformBackup).not.toHaveBeenCalled();
  });

  it("rejects a request without the bearer token", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(runPlatformBackup).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(runPlatformBackup).not.toHaveBeenCalled();
  });

  it("never checks in for an unauthorized probe", async () => {
    await GET(cronRequest("Bearer wrong"));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/platform-backup — the uploader credential", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.warn).mockRestore();
  });

  it("answers 501 and stores nothing when the uploader is not configured", async () => {
    vi.stubEnv("PLATFORM_BACKUP_BUCKET", "");

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(501);
    expect(runPlatformBackup).not.toHaveBeenCalled();
  });

  // The important half: an unconfigured deployment must not tell the cron
  // monitor that a backup happened, or a missing backup reads as a healthy one
  // forever.
  it("never checks in when the uploader is not configured", async () => {
    vi.stubEnv("PLATFORM_BACKUP_BUCKET", "");

    await GET(cronRequest(`Bearer ${secret}`));

    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });

  it("says so in the log rather than failing silently", async () => {
    vi.stubEnv("PLATFORM_BACKUP_BUCKET", "");

    await GET(cronRequest(`Bearer ${secret}`));

    const warned = vi
      .mocked(console.warn)
      .mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>);
    expect(warned).toContainEqual(
      expect.objectContaining({ event: "cron_platform_backup.not_configured" }),
    );
  });
});

describe("GET /api/cron/platform-backup — the weekly pass", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("stores a bundle for every shop and reports a clean pass", async () => {
    vi.mocked(listShopsForPlatformBackup).mockResolvedValue([
      shop("blue-mantis"),
      shop("coral-reef"),
    ] as never);

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ shops: 2, stored: 2, failed: 0 });
    expect(runPlatformBackup).toHaveBeenCalledTimes(2);
    expect(runPlatformBackup).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ shopId: "shop-blue-mantis" }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  it("hands the uploader credential down from the environment", async () => {
    vi.mocked(listShopsForPlatformBackup).mockResolvedValue([shop("blue-mantis")] as never);

    await GET(cronRequest(`Bearer ${secret}`));

    expect(runPlatformBackup).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({
        config: {
          accessKeyId: "AKIA-TEST",
          secretAccessKey: "secret",
          bucket: "diveday-backups",
          region: "us-east-1",
        },
      }),
    );
  });

  it("resolves each shop's calendar labels rather than passing keys", async () => {
    vi.mocked(listShopsForPlatformBackup).mockResolvedValue([shop("blue-mantis")] as never);

    await GET(cronRequest(`Bearer ${secret}`));

    const input = vi.mocked(runPlatformBackup).mock.calls[0]?.[1] as {
      icsLabels: { calendarName: string; day: (n: number) => string };
    };
    expect(input.icsLabels.calendarName).toContain("blue-mantis");
    expect(input.icsLabels.day(2)).toMatch(/2/);
  });

  // The invariant that makes this safe to run unattended.
  it("keeps going after one shop fails, and reports the pass as unclean", async () => {
    vi.mocked(listShopsForPlatformBackup).mockResolvedValue([
      shop("blue-mantis"),
      shop("coral-reef"),
      shop("deep-blue"),
    ] as never);
    vi.mocked(runPlatformBackup)
      .mockResolvedValueOnce({ status: "stored", objectKey: "a.zip", byteCount: 1 } as never)
      .mockResolvedValueOnce({ status: "failed", errorCode: "upload_unauthorized" } as never)
      .mockResolvedValueOnce({ status: "stored", objectKey: "c.zip", byteCount: 1 } as never);

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ shops: 3, stored: 2, failed: 1 });
    expect(runPlatformBackup).toHaveBeenCalledTimes(3);
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("names the failed shops and their codes without leaking anything else", async () => {
    vi.mocked(listShopsForPlatformBackup).mockResolvedValue([shop("coral-reef")] as never);
    vi.mocked(runPlatformBackup).mockResolvedValue({
      status: "failed",
      errorCode: "bucket_not_found",
    } as never);

    await GET(cronRequest(`Bearer ${secret}`));

    expect(logLines()).toContainEqual(
      expect.objectContaining({
        event: "cron_platform_backup.pass_complete",
        stored: 0,
        failed: 1,
        failedShops: "coral-reef",
      }),
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "platform backup failed for a shop",
      expect.objectContaining({
        tags: { backup_shop: "coral-reef", backup_error: "bucket_not_found" },
      }),
    );
  });

  it("survives a bootstrap failure with the code the alarm counts", async () => {
    vi.mocked(listShopsForPlatformBackup).mockRejectedValue(new Error("db gone"));

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(503);
    const errors = vi
      .mocked(console.error)
      .mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>);
    // The exact code infra/lib/observability.ts's CronPassFailures filter reads.
    expect(errors).toContainEqual(
      expect.objectContaining({ event: "cron_platform_backup.pass_failed" }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("reports an empty estate as a clean pass rather than an incident", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ shops: 0, stored: 0, failed: 0 });
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });
});
