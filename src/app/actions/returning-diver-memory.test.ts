// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  delete: vi.fn(),
  read: vi.fn(),
  acknowledge: vi.fn(),
  revoke: vi.fn(),
  getDb: vi.fn(() => ({ db: true })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.get, delete: mocks.delete })),
}));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/booking-capabilities", () => ({
  readReturningDiverReceipt: mocks.read,
  acknowledgeReturningDiverReceipt: mocks.acknowledge,
  revokeReturningDiverReceipt: mocks.revoke,
}));

const {
  acknowledgeReturningDiverMemory,
  prepareReturningDiverMemory,
  revokeClearedReturningDiverReceipt,
} = await import("./returning-diver-memory");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockReturnValue({ value: "receipt-token-that-is-long-enough" });
});

describe("returning-diver memory server actions", () => {
  it("returns only the receipt-authorized shop identity and never accepts caller identity", async () => {
    mocks.read.mockResolvedValue({
      receiptId: "receipt-row-id",
      shopSlug: "blue-mantis",
      diver: { fullName: "Marco Reyes", email: "marco@example.com" },
      memoryExpiresAt: 200,
    });

    await expect(prepareReturningDiverMemory()).resolves.toEqual({
      kind: "ready",
      receiptId: "receipt-row-id",
      shopSlug: "blue-mantis",
      diver: { fullName: "Marco Reyes", email: "marco@example.com" },
      expiresAt: 200,
    });
    expect(mocks.read).toHaveBeenCalledWith(
      { db: true },
      { receiptToken: "receipt-token-that-is-long-enough" },
    );
  });

  it("returns no identity and clears a mismatched or invalid receipt", async () => {
    mocks.read.mockResolvedValue(null);

    await expect(prepareReturningDiverMemory()).resolves.toBeNull();

    expect(mocks.delete).toHaveBeenCalledWith("diveday-returning-diver-receipt");
  });

  it("acknowledges only the prepared receipt id bound to the current HttpOnly cookie", async () => {
    mocks.acknowledge.mockResolvedValue(true);

    await expect(acknowledgeReturningDiverMemory("receipt-row-id")).resolves.toBe(true);

    expect(mocks.acknowledge).toHaveBeenCalledWith(
      { db: true },
      {
        receiptToken: "receipt-token-that-is-long-enough",
        expectedReceiptId: "receipt-row-id",
      },
    );
    expect(mocks.delete).toHaveBeenCalledWith("diveday-returning-diver-receipt");
  });

  it("revokes only the matching receipt and shop on clear", async () => {
    mocks.revoke.mockResolvedValue(true);
    const receiptId = "00000000-0000-0000-0000-000000000001";

    await expect(revokeClearedReturningDiverReceipt("blue-mantis", receiptId)).resolves.toBe(true);

    expect(mocks.revoke).toHaveBeenCalledWith(
      { db: true },
      {
        receiptToken: "receipt-token-that-is-long-enough",
        expectedReceiptId: receiptId,
        shopSlug: "blue-mantis",
      },
    );
    expect(mocks.delete).toHaveBeenCalledWith("diveday-returning-diver-receipt");
  });
});
