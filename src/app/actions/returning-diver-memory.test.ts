// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  acknowledge: vi.fn(),
  revoke: vi.fn(),
  getDb: vi.fn(() => ({ db: true })),
  shopIdBySlug: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/shops", () => ({ shopIdBySlug: mocks.shopIdBySlug }));
vi.mock("@/db/booking-capabilities", () => ({
  readReturningDiverReceipt: mocks.read,
  acknowledgeReturningDiverReceipt: mocks.acknowledge,
  revokeReturningDiverReceipt: mocks.revoke,
  verifyBookingCapability: mocks.verify,
}));

const {
  acknowledgeReturningDiverMemory,
  getReturningDiverServerTime,
  prepareReturningDiverMemories,
  revokeClearedReturningDiverReceipt,
} = await import("./returning-diver-memory");

const DEVICE_TOKEN = "a".repeat(64);
const RECEIPT_ID = "00000000-0000-0000-0000-000000000001";
const GENERATION = "11111111-1111-4111-8111-111111111111";
const SHOP_SCOPE = { kind: "shop" as const, shopSlug: "blue-mantis" };
const READY_SCOPE = {
  kind: "readiness" as const,
  readinessToken: "ready-token-1234567890123456789012345678901234567890",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shopIdBySlug.mockResolvedValue("shop-blue");
  mocks.verify.mockResolvedValue({ shopId: "shop-blue" });
});

describe("returning-diver memory server actions", () => {
  it("resolves only receipt-bound shop identity for an opaque slot", async () => {
    mocks.read.mockResolvedValue({
      receiptId: RECEIPT_ID,
      receiptOrder: "38",
      deviceGeneration: GENERATION,
      shopSlug: "blue-mantis",
      diver: { fullName: "Marco Reyes", email: "marco@example.com" },
      memoryExpiresAt: 200,
    });

    await expect(
      prepareReturningDiverMemories(SHOP_SCOPE, [{ token: DEVICE_TOKEN, generation: GENERATION }]),
    ).resolves.toEqual([
      {
        deviceToken: DEVICE_TOKEN,
        receiptId: RECEIPT_ID,
        receiptOrder: "38",
        deviceGeneration: GENERATION,
        shopSlug: "blue-mantis",
        diver: { fullName: "Marco Reyes", email: "marco@example.com" },
        expiresAt: 200,
      },
    ]);
    expect(mocks.read).toHaveBeenCalledWith(
      { db: true },
      { deviceToken: DEVICE_TOKEN, deviceGeneration: GENERATION, expectedShopId: "shop-blue" },
    );
    expect(mocks.shopIdBySlug).toHaveBeenCalledWith({ db: true }, "blue-mantis");
  });

  it("returns no identity for mismatched receipt state or invalid slot input", async () => {
    mocks.read.mockResolvedValue(null);
    await expect(
      prepareReturningDiverMemories(SHOP_SCOPE, [{ token: DEVICE_TOKEN, generation: null }]),
    ).resolves.toEqual([]);
    await expect(
      prepareReturningDiverMemories(SHOP_SCOPE, [{ token: "not-a-slot", generation: null }]),
    ).resolves.toEqual([]);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("derives a readiness route scope from its validated capability", async () => {
    mocks.read.mockResolvedValue(null);
    await expect(
      prepareReturningDiverMemories(READY_SCOPE, [{ token: DEVICE_TOKEN, generation: null }]),
    ).resolves.toEqual([]);
    expect(mocks.verify).toHaveBeenCalledWith(
      { db: true },
      { token: READY_SCOPE.readinessToken, purpose: "readiness" },
    );
    expect(mocks.read).toHaveBeenCalledWith(
      { db: true },
      { deviceToken: DEVICE_TOKEN, deviceGeneration: null, expectedShopId: "shop-blue" },
    );
  });

  it("does not return a mismatched shop row even if a reader violates its scope contract", async () => {
    mocks.shopIdBySlug.mockResolvedValue("shop-red");
    mocks.read.mockResolvedValue({ shopSlug: "blue-mantis", diver: { fullName: "A", email: "a" } });
    await expect(
      prepareReturningDiverMemories({ kind: "shop", shopSlug: "red-reef" }, [
        { token: DEVICE_TOKEN, generation: null },
      ]),
    ).resolves.toEqual([]);
    expect(mocks.read).toHaveBeenCalledWith(
      { db: true },
      { deviceToken: DEVICE_TOKEN, deviceGeneration: null, expectedShopId: "shop-red" },
    );
  });

  it("acknowledges only the prepared row bound to the presented device slot", async () => {
    mocks.acknowledge.mockResolvedValue(true);
    await expect(
      acknowledgeReturningDiverMemory(SHOP_SCOPE, DEVICE_TOKEN, RECEIPT_ID, GENERATION),
    ).resolves.toBe(true);
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      { db: true },
      {
        deviceToken: DEVICE_TOKEN,
        expectedReceiptId: RECEIPT_ID,
        deviceGeneration: GENERATION,
        expectedShopId: "shop-blue",
      },
    );
  });

  it("returns only the server clock for local expiry checks", async () => {
    await expect(getReturningDiverServerTime()).resolves.toEqual(expect.any(Number));
  });

  it("revokes only the resolved shop's prior device generation", async () => {
    mocks.revoke.mockResolvedValue(true);
    await expect(
      revokeClearedReturningDiverReceipt("blue-mantis", DEVICE_TOKEN, null, GENERATION),
    ).resolves.toBe(true);
    expect(mocks.revoke).toHaveBeenCalledWith(
      { db: true },
      {
        deviceToken: DEVICE_TOKEN,
        expectedShopId: "shop-blue",
        previousDeviceGeneration: null,
        nextDeviceGeneration: GENERATION,
      },
    );
  });
});
