// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetReturningDiver,
  saveReturningDiver,
  snapshotReturningDiverClearGenerations,
} from "@/lib/returning-diver";
import { RetryReturningDiverMemory } from "./RetryReturningDiverMemory";

let pathname = "/ready/original";
const prepare = vi.fn();
const acknowledge = vi.fn();
const revoke = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/app/actions/returning-diver-memory", () => ({
  prepareReturningDiverMemory: () => prepare(),
  acknowledgeReturningDiverMemory: (...args: unknown[]) => acknowledge(...args),
  revokeClearedReturningDiverReceipt: (...args: unknown[]) => revoke(...args),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  pathname = "/ready/original";
});

describe("RetryReturningDiverMemory", () => {
  it("retries on a later navigation after the initial response was lost", async () => {
    prepare.mockResolvedValue({
      kind: "ready",
      shopSlug: "blue-mantis",
      receiptId: "receipt-a",
      diver: { fullName: "Marco Reyes", email: "marco@example.com" },
      expiresAt: Date.now() + 86_400_000,
    });
    acknowledge.mockRejectedValueOnce(new Error("response lost")).mockResolvedValue(true);
    const view = render(<RetryReturningDiverMemory />);
    await waitFor(() =>
      expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toContain(
        "Marco Reyes",
      ),
    );
    expect(acknowledge).toHaveBeenCalledTimes(1);

    // The cookie remains after the lost acknowledgement response, so the same
    // write can be safely retried on a later navigation.
    // Even if the visitor moves to a different shop, the receipt's server
    // binding decides which shop-scoped memory gets written.
    pathname = "/s/red-reef/trips/next";
    view.rerender(<RetryReturningDiverMemory />);
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem("diveday:returning-diver:v2:red-reef")).toBeNull();
  });

  it("does not acknowledge when storage is blocked and does nothing without consent", async () => {
    prepare
      .mockResolvedValueOnce({
        kind: "ready",
        shopSlug: "blue-mantis",
        receiptId: "receipt-b",
        diver: { fullName: "Marco Reyes", email: "marco@example.com" },
        expiresAt: Date.now() + 86_400_000,
      })
      .mockResolvedValueOnce(null);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const view = render(<RetryReturningDiverMemory />);
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(acknowledge).not.toHaveBeenCalled();

    pathname = "/s/another-shop/trips/next";
    await act(async () => view.rerender(<RetryReturningDiverMemory />));
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("does not resurrect a cleared diver after an ack failure and later navigation", async () => {
    prepare.mockResolvedValue({
      kind: "ready",
      shopSlug: "blue-mantis",
      receiptId: "receipt-cleared",
      diver: { fullName: "Marco Reyes", email: "marco@example.com" },
      expiresAt: Date.now() + 86_400_000,
    });
    acknowledge.mockRejectedValueOnce(new Error("ack response lost")).mockResolvedValue(true);
    const view = render(<RetryReturningDiverMemory />);
    await waitFor(() =>
      expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toContain(
        "Marco Reyes",
      ),
    );

    forgetReturningDiver("blue-mantis");
    expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
    pathname = "/s/red-reef/trips/next";
    view.rerender(<RetryReturningDiverMemory />);

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blue-mantis", "receipt-cleared"));
    expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
    expect(localStorage.getItem("diveday:returning-diver:v2:red-reef")).toBeNull();
  });

  it("fences a response already in flight when the user clears that receipt", async () => {
    let resolvePrepare!: (result: unknown) => void;
    prepare.mockReturnValue(new Promise((resolve) => (resolvePrepare = resolve)));
    acknowledge.mockResolvedValue(true);
    saveReturningDiver(
      "blue-mantis",
      { fullName: "Marco Reyes", email: "marco@example.com" },
      Date.now() + 86_400_000,
      new Date(),
      {
        id: "receipt-in-flight",
        generationAtStart: snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null,
      },
    );
    render(<RetryReturningDiverMemory />);
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));

    forgetReturningDiver("blue-mantis");
    await act(async () => {
      resolvePrepare({
        kind: "ready",
        shopSlug: "blue-mantis",
        receiptId: "receipt-in-flight",
        diver: { fullName: "Marco Reyes", email: "marco@example.com" },
        expiresAt: Date.now() + 86_400_000,
      });
    });

    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blue-mantis", "receipt-in-flight"));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("receipt-in-flight"));
    expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
  });
});
