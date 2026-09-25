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
        sendFailedLabel="That didn’t send. Try again."
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

  it("shows the in-flight word on a row that trails nothing at rest", async () => {
    // The checked-in row's undo draws no trailing slot until it is tapped;
    // the slot has to come back for the pending word. The send is held open
    // until the word is seen, then let go: React entangles every later
    // transition with an async action still in flight, so one left pending
    // would hold up the next test's form.
    let land: (result: { ok: true }) => void = () => {};
    const send = new Promise<{ ok: true }>((resolve) => {
      land = resolve;
    });
    render(
      <CheckInActionForm
        action={vi.fn(() => send)}
        bookingId="book-1"
        sendFailedLabel="That didn’t send. Try again."
        ariaLabel="Undo check-in for Marie Tharp"
        trailing={null}
        pendingTrailing={<span>Undoing…</span>}
      >
        <span>Marie Tharp</span>
      </CheckInActionForm>,
    );

    const button = screen.getByRole("button", { name: "Undo check-in for Marie Tharp" });
    expect(button.children).toHaveLength(1);
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveTextContent("Undoing…");
    });
    land({ ok: true });
    await waitFor(() => {
      expect(button).not.toHaveTextContent("Undoing…");
    });
  });

  it("displays failure alert when server action rejects", async () => {
    const failingAction = vi.fn().mockRejectedValue(new Error("Network failed"));
    render(
      <CheckInActionForm
        action={failingAction}
        bookingId="book-1"
        sendFailedLabel="That didn’t send. Try again."
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
      expect(screen.getByRole("alert")).toHaveTextContent("That didn’t send. Try again.");
    });
  });
});
