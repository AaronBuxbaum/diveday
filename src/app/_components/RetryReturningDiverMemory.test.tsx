// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetReturningDiver } from "@/lib/returning-diver";
import { RetryReturningDiverMemory } from "./RetryReturningDiverMemory";

let pathname = "/ready/original";
const prepare = vi.fn();
const acknowledge = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/app/actions/returning-diver-memory", () => ({
  prepareReturningDiverMemory: () => prepare(),
  acknowledgeReturningDiverMemory: () => acknowledge(),
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
      issuedAt: Date.now() - 1000,
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
        issuedAt: Date.now() - 1000,
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
    const issuedAt = Date.now() - 1000;
    prepare.mockResolvedValue({
      kind: "ready",
      shopSlug: "blue-mantis",
      receiptId: "receipt-cleared",
      issuedAt,
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

    forgetReturningDiver("blue-mantis", new Date(issuedAt + 1));
    expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
    pathname = "/s/red-reef/trips/next";
    view.rerender(<RetryReturningDiverMemory />);

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
    expect(localStorage.getItem("diveday:returning-diver:v2:red-reef")).toBeNull();
  });
});
