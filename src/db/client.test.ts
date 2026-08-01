import { describe, expect, it, vi } from "vitest";

vi.mock("./seed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./seed")>();
  return {
    ...actual,
    seedIfEmpty: vi.fn(actual.seedIfEmpty),
    backfillDemoReportingData: vi.fn(actual.backfillDemoReportingData),
  };
});
vi.mock("./shops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shops")>();
  return {
    ...actual,
    backfillLegacyNitroxOffering: vi.fn(actual.backfillLegacyNitroxOffering),
  };
});

const { createTestDb, isDemoShopSeeded, seedProductionDb } = await import("./client");
const { seedIfEmpty, backfillDemoReportingData } = await import("./seed");
const { backfillLegacyNitroxOffering } = await import("./shops");

describe("seedProductionDb (cold-start fast path)", () => {
  it("runs the full seed/backfill block on a genuinely fresh database", async () => {
    const db = await createTestDb();
    await expect(isDemoShopSeeded(db)).resolves.toBe(false);

    await seedProductionDb(db);

    expect(seedIfEmpty).toHaveBeenCalledTimes(1);
    expect(backfillDemoReportingData).toHaveBeenCalledTimes(1);
    expect(backfillLegacyNitroxOffering).toHaveBeenCalledTimes(1);
    await expect(isDemoShopSeeded(db)).resolves.toBe(true);
  });

  it("skips the lock and every backfill once the demo-shop marker is present", async () => {
    const db = await createTestDb();
    // Seed once directly (bypassing the fast path under test) so the marker
    // is present before we exercise seedProductionDb.
    await seedIfEmpty(db);
    await expect(isDemoShopSeeded(db)).resolves.toBe(true);
    vi.mocked(seedIfEmpty).mockClear();
    vi.mocked(backfillDemoReportingData).mockClear();
    vi.mocked(backfillLegacyNitroxOffering).mockClear();

    const lock = vi.fn(async () => undefined);
    await seedProductionDb(db, { lock });

    expect(lock).not.toHaveBeenCalled();
    expect(seedIfEmpty).not.toHaveBeenCalled();
    expect(backfillDemoReportingData).not.toHaveBeenCalled();
    expect(backfillLegacyNitroxOffering).not.toHaveBeenCalled();
  });
});
