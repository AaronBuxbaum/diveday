// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckInActionForm } from "./CheckInActionForm";

afterEach(() => {
  cleanup();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
  unstable_rethrow: vi.fn(),
}));

describe("CheckInActionForm", () => {
  it("renders the initial trailing label and diver name", () => {
    render(
      <CheckInActionForm
        action={vi.fn().mockResolvedValue({ ok: true })}
        bookingId="book-1"
        sendFailedLabel="That didn't send. Try again."
        ariaLabel="Check in Marie Tharp"
        trailing={<span>Check in</span>}
        pendingTrailing={<span>Checking in…</span>}
      >
        <span>Marie Tharp</span>
      </CheckInActionForm>,
    );

    expect(screen.getByText("Marie Tharp")).toBeInTheDocument();
    expect(screen.getByText("Check in")).toBeInTheDocument();
  });

  it("displays failure alert when server action rejects", async () => {
    const failingAction = vi.fn().mockRejectedValue(new Error("Network failed"));
    render(
      <CheckInActionForm
        action={failingAction}
        bookingId="book-1"
        sendFailedLabel="That didn't send. Try again."
        ariaLabel="Check in Marie Tharp"
        trailing={<span>Check in</span>}
        pendingTrailing={<span>Checking in…</span>}
      >
        <span>Marie Tharp</span>
      </CheckInActionForm>,
    );

    const button = screen.getByRole("button", { name: "Check in Marie Tharp" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("That didn't send. Try again.");
    });
  });
});
