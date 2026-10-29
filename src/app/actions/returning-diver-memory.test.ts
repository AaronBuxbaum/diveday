// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  acknowledge: vi.fn(),
  revoke: vi.fn(),
  getDb: vi.fn(() => ({ db: true })),
}));

vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/booking-capabilities", () => ({
  readReturningDiverReceipt: mocks.read,
  acknowledgeReturningDiverReceipt: mocks.acknowledge,
  revokeReturningDiverReceipt: mocks.revoke,
}));

const {
  acknowledgeReturningDiverMemory,
  prepareReturningDiverMemories,
  revokeClearedReturningDiverReceipt,
} = await import("./returning-diver-memory");

const DEVICE_TOKEN = "a".repeat(64);
const RECEIPT_ID = "00000000-0000-0000-0000-000000000001";
const GENERATION = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
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
      prepareReturningDiverMemories([{ token: DEVICE_TOKEN, generation: GENERATION }]),
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
      { deviceToken: DEVICE_TOKEN, deviceGeneration: GENERATION },
    );
  });

  it("returns no identity for mismatched receipt state or invalid slot input", async () => {
    mocks.read.mockResolvedValue(null);
    await expect(
      prepareReturningDiverMemories([{ token: DEVICE_TOKEN, generation: null }]),
    ).resolves.toEqual([]);
    await expect(
      prepareReturningDiverMemories([{ token: "not-a-slot", generation: null }]),
    ).resolves.toEqual([]);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("acknowledges only the prepared row bound to the presented device slot", async () => {
    mocks.acknowledge.mockResolvedValue(true);
    await expect(
      acknowledgeReturningDiverMemory(DEVICE_TOKEN, RECEIPT_ID, GENERATION),
    ).resolves.toBe(true);
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      { db: true },
      {
        deviceToken: DEVICE_TOKEN,
        expectedReceiptId: RECEIPT_ID,
        deviceGeneration: GENERATION,
      },
    );
  });

  it("revokes a cleared slot across receipts without accepting caller-selected shop identity", async () => {
    mocks.revoke.mockResolvedValue(true);
    await expect(revokeClearedReturningDiverReceipt(DEVICE_TOKEN, GENERATION)).resolves.toBe(true);
    expect(mocks.revoke).toHaveBeenCalledWith(
      { db: true },
      {
        deviceToken: DEVICE_TOKEN,
        nextDeviceGeneration: GENERATION,
      },
    );
  });
});
