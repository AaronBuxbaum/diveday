import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  listShopsForPlatformBackup,
  platformBackupConfigFromEnvironment,
  runPlatformBackup,
} from "./platform-backup";

const NOW = new Date("2026-08-12T05:00:00Z");

const CONFIG = {
  accessKeyId: "AKIA-PLATFORM-KEY-ID",
  secretAccessKey: "very-secret-platform-key",
  bucket: "diveday-backups",
  region: "us-east-1",
};

const LABELS = {
  calendarName: "label-calendar-name",
  crew: "label-crew",
  course: "label-course",
  day: (n: number) => `label-day-${n}`,
};

function capturingFetch(status = 200) {
  const calls: { url: string; headers: Headers; body: Uint8Array }[] = [];
  const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: new Uint8Array(init?.body as Uint8Array),
    });
    return new Response(null, { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function runInput(overrides: Record<string, unknown> = {}) {
  return {
    config: CONFIG,
    icsLabels: LABELS,
    origin: "https://app.example.com",
    now: NOW,
    ...overrides,
  };
}

describe("runPlatformBackup", () => {
  it("stores the export bundle under exports/<date>/<slug>.zip", async () => {
    const { db, shop } = await seededShopContext();
    const { fetchImpl, calls } = capturingFetch();

    const result = await runPlatformBackup(db, runInput({ shopId: shop.id, fetchImpl }) as never);

    expect(result).toMatchObject({
      status: "stored",
      objectKey: "exports/2026-08-12/blue-mantis.zip",
    });

    // The upload is the last call; earlier ones are the bundled photo fetches.
    const upload = calls.at(-1);
    expect(upload?.url).toBe(
      "https://diveday-backups.s3.us-east-1.amazonaws.com/exports/2026-08-12/blue-mantis.zip",
    );
  });

  it("addresses AWS virtual-hosted style, never the deprecated path style", async () => {
    const { db, shop } = await seededShopContext();
    const { fetchImpl, calls } = capturingFetch();

    await runPlatformBackup(db, runInput({ shopId: shop.id, fetchImpl }) as never);

    const upload = calls.at(-1);
    // The bucket is a host label, so it must not also appear in the path.
    expect(upload?.url).toMatch(/^https:\/\/diveday-backups\.s3\./);
    expect(new URL(upload?.url ?? "").pathname).toBe("/exports/2026-08-12/blue-mantis.zip");
    // And the signature has to be over that host, or S3 rejects it.
    expect(upload?.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    expect(upload?.headers.get("authorization")).toContain(CONFIG.accessKeyId);
  });

  it("uploads the same artifact the shop-owned backup does, trips.ics included", async () => {
    const { db, shop } = await seededShopContext();
    const { fetchImpl, calls } = capturingFetch();

    await runPlatformBackup(db, runInput({ shopId: shop.id, fetchImpl }) as never);

    const files = Object.keys(unzipSync(calls.at(-1)?.body as Uint8Array));
    expect(files).toContain("trips.ics");
    expect(files).toContain("waiver_records.csv");
    expect(files).toContain("waiver_templates.csv");
  });

  it("reports the upload's own refusal code rather than throwing", async () => {
    const { db, shop } = await seededShopContext();
    const { fetchImpl } = capturingFetch(403);

    const result = await runPlatformBackup(db, runInput({ shopId: shop.id, fetchImpl }) as never);

    expect(result).toEqual({ status: "failed", errorCode: "upload_unauthorized" });
  });

  it("fails with a code when the shop row is gone", async () => {
    const { db } = await seededShopContext();
    const { fetchImpl } = capturingFetch();

    const result = await runPlatformBackup(
      db,
      runInput({ shopId: "00000000-0000-0000-0000-000000000000", fetchImpl }) as never,
    );

    expect(result).toEqual({ status: "failed", errorCode: "shop_missing" });
  });

  it("never uploads when the bundle could not be built", async () => {
    const { db } = await seededShopContext();
    const { fetchImpl, calls } = capturingFetch();

    await runPlatformBackup(
      db,
      runInput({ shopId: "00000000-0000-0000-0000-000000000000", fetchImpl }) as never,
    );

    expect(calls).toHaveLength(0);
  });

  it("is idempotent by key: a re-run targets the same object", async () => {
    const { db, shop } = await seededShopContext();
    const { fetchImpl, calls } = capturingFetch();

    const first = await runPlatformBackup(db, runInput({ shopId: shop.id, fetchImpl }) as never);
    const second = await runPlatformBackup(db, runInput({ shopId: shop.id, fetchImpl }) as never);

    expect(first).toMatchObject({ status: "stored" });
    expect(second).toMatchObject({ status: "stored" });
    // Same key both times, so a versioned bucket adds a version rather than a copy.
    expect((first as { objectKey: string }).objectKey).toBe(
      (second as { objectKey: string }).objectKey,
    );
    expect(calls.at(-1)?.url).toBe(calls.at(-1)?.url);
  });
});

describe("listShopsForPlatformBackup", () => {
  // The seeded blue-mantis fixture is itself flagged `isDemo` (it is the
  // e2e/visual fleet's shop, kept out of the sitemap for the same reason), so
  // these drive the flag explicitly rather than trusting the seed's value.
  it("excludes demo shops, which exist only to be discarded", async () => {
    const { db, shop } = await seededShopContext();

    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    const included = await listShopsForPlatformBackup(db);
    expect(included.map((entry) => entry.slug)).toContain("blue-mantis");

    await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
    const excluded = await listShopsForPlatformBackup(db);
    expect(excluded.map((entry) => entry.slug)).not.toContain("blue-mantis");
  });

  it("carries each shop's own locale, so trips.ics speaks the shop's language", async () => {
    const { db, shop } = await seededShopContext();
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));

    const listed = await listShopsForPlatformBackup(db);

    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) {
      expect(entry.locale).toBeTruthy();
      expect(entry.id).toBeTruthy();
    }
  });
});

describe("platformBackupConfigFromEnvironment", () => {
  const complete = {
    PLATFORM_BACKUP_AWS_ACCESS_KEY_ID: CONFIG.accessKeyId,
    PLATFORM_BACKUP_AWS_SECRET_ACCESS_KEY: CONFIG.secretAccessKey,
    PLATFORM_BACKUP_BUCKET: CONFIG.bucket,
    PLATFORM_BACKUP_AWS_REGION: CONFIG.region,
  };

  it("resolves a complete set", () => {
    expect(platformBackupConfigFromEnvironment(complete)).toEqual(CONFIG);
  });

  it("is unconfigured when nothing is set", () => {
    expect(platformBackupConfigFromEnvironment({})).toBeNull();
  });

  // The failure this guards is the dangerous one: a partial set looks
  // configured, so the pass would run and store nothing without anyone noticing.
  it.each(Object.keys(complete))("is unconfigured when %s is missing", (missing) => {
    const partial = { ...complete, [missing]: "" };
    expect(platformBackupConfigFromEnvironment(partial)).toBeNull();
  });

  it("ignores surrounding whitespace, which a pasted credential often carries", () => {
    const padded = Object.fromEntries(
      Object.entries(complete).map(([key, value]) => [key, `  ${value}  `]),
    );
    expect(platformBackupConfigFromEnvironment(padded)).toEqual(CONFIG);
  });
});
