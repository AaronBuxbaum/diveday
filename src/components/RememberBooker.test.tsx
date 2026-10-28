// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETURNING_DIVER_MEMORY_MS } from "@/lib/returning-diver";

import { RememberBooker } from "./RememberBooker";

const redeem = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  redeem.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RememberBooker", () => {
  it("waits for authorized asynchronous redemption before writing shop memory", async () => {
    let finish!: (value: { diver: { fullName: string; email: string }; expiresAt: number }) => void;
    redeem.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    render(
      <RememberBooker
        shopSlug="blue-mantis"
        redirectReadinessToken="redirect-token"
        redeemReceipt={redeem}
      />,
    );
    expect(redeem).toHaveBeenCalledWith("redirect-token");
    expect(window.localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();

    await act(async () => {
      finish({
        diver: { fullName: "Marco Reyes", email: "marco@example.com" },
        expiresAt: Date.now() + RETURNING_DIVER_MEMORY_MS,
      });
    });

    expect(
      JSON.parse(window.localStorage.getItem("diveday:returning-diver:v2:blue-mantis") ?? "null"),
    ).toMatchObject({ fullName: "Marco Reyes", email: "marco@example.com" });
  });

  it("can finish the write after fast onward navigation unmounts the component", async () => {
    let finish!: (value: { diver: { fullName: string; email: string }; expiresAt: number }) => void;
    redeem.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const { unmount } = render(
      <RememberBooker
        shopSlug="blue-mantis"
        redirectReadinessToken="redirect-token"
        redeemReceipt={redeem}
      />,
    );
    unmount();
    await act(async () => {
      finish({
        diver: { fullName: "Marco Reyes", email: "marco@example.com" },
        expiresAt: Date.now() + RETURNING_DIVER_MEMORY_MS,
      });
    });
    expect(window.localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toContain(
      "Marco Reyes",
    );
  });

  it("leaves the confirmation path alone when redemption or storage is unavailable", async () => {
    redeem.mockResolvedValue({
      diver: { fullName: "Marco Reyes", email: "marco@example.com" },
      expiresAt: Date.now() + RETURNING_DIVER_MEMORY_MS,
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const { container } = render(
      <RememberBooker
        shopSlug="blue-mantis"
        redirectReadinessToken="redirect-token"
        redeemReceipt={redeem}
      />,
    );
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(window.localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
  });
});
