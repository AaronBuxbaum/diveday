// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetReturningDiver,
  getReturningDiverDeviceSlots,
  loadReturningDiver,
} from "@/lib/returning-diver";
import { RetryReturningDiverMemory } from "./RetryReturningDiverMemory";

const readinessToken = "r".repeat(48);
let pathname = `/ready/${readinessToken}`;
const prepare = vi.fn();
const acknowledge = vi.fn();
const revoke = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/app/actions/returning-diver-memory", () => ({
  prepareReturningDiverMemories: (...args: unknown[]) => prepare(...args),
  acknowledgeReturningDiverMemory: (...args: unknown[]) => acknowledge(...args),
  revokeClearedReturningDiverReceipt: (...args: unknown[]) => revoke(...args),
}));

const token = "a".repeat(64);
const receiptA = "00000000-0000-4000-8000-000000000011";
const receiptB = "00000000-0000-4000-8000-000000000012";
const receiptCleared = "00000000-0000-4000-8000-000000000013";
const slotKey = "diveday:returning-diver:device:v1:blue-mantis";

function addSlot() {
  sessionStorage.setItem(slotKey, JSON.stringify({ token, expiresAt: Date.now() + 86_400_000 }));
}

function memory(receiptId: string, receiptOrder = "38") {
  return {
    deviceToken: token,
    receiptId,
    receiptOrder,
    deviceGeneration: null,
    shopSlug: "blue-mantis",
    diver: { fullName: "Marco Reyes", email: "marco@example.com" },
    expiresAt: Date.now() + 86_400_000,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  pathname = `/ready/${readinessToken}`;
});

describe("RetryReturningDiverMemory", () => {
  it("retries a lost acknowledgement on later same-origin navigation using the opted-in slot", async () => {
    addSlot();
    prepare.mockResolvedValue([memory(receiptA)]);
    acknowledge.mockRejectedValueOnce(new Error("response lost")).mockResolvedValue(true);
    const view = render(<RetryReturningDiverMemory />);

    await waitFor(() =>
      expect(loadReturningDiver("blue-mantis")).toEqual({
        fullName: "Marco Reyes",
        email: "marco@example.com",
      }),
    );
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    expect(prepare).toHaveBeenCalledWith({ kind: "readiness", readinessToken }, [
      { token, generation: null },
    ]);

    pathname = "/s/blue-mantis/trips/next";
    view.rerender(<RetryReturningDiverMemory />);
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
    expect(loadReturningDiver("red-reef")).toBeNull();
  });

  it("does not deliver one shop's receipt to a different shop route", async () => {
    pathname = "/s/red-reef/trips/next";
    addSlot();
    prepare.mockResolvedValue([memory(receiptA)]);
    render(<RetryReturningDiverMemory />);

    await waitFor(() => expect(prepare).not.toHaveBeenCalled());
    expect(acknowledge).not.toHaveBeenCalled();
    expect(loadReturningDiver("blue-mantis")).toBeNull();
    expect(loadReturningDiver("red-reef")).toBeNull();
  });

  it("does not create or submit a slot without explicit opt-in", async () => {
    prepare.mockResolvedValue([]);
    render(<RetryReturningDiverMemory />);
    await waitFor(() => expect(prepare).not.toHaveBeenCalled());
    expect(getReturningDiverDeviceSlots()).toEqual([]);
  });

  it("does not acknowledge when storage is blocked", async () => {
    addSlot();
    prepare.mockResolvedValue([memory(receiptB)]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    render(<RetryReturningDiverMemory />);
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(acknowledge).not.toHaveBeenCalled());
  });

  it("fences a receipt response already in flight when the user clears the shop memory", async () => {
    addSlot();
    let resolvePrepare!: (result: unknown) => void;
    prepare.mockReturnValue(new Promise((resolve) => (resolvePrepare = resolve)));
    render(<RetryReturningDiverMemory />);
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));

    forgetReturningDiver("blue-mantis");
    expect(loadReturningDiver("blue-mantis")).toBeNull();
    await act(async () => resolvePrepare([memory(receiptCleared)]));

    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith("blue-mantis", token, null, expect.any(String)),
    );
    expect(acknowledge).not.toHaveBeenCalled();
    expect(loadReturningDiver("blue-mantis")).toBeNull();
  });
});
