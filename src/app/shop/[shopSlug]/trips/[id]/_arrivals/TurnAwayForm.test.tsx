// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnAwayForm } from "./TurnAwayForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const copy = {
  legend: "Reason",
  consequence: "The seat is released.",
  confirm: "Confirm turn-away",
  confirming: "Recording…",
  confirmAriaLabel: "Turn away booking-a",
  sendFailed: "Not sent. Retry.",
};

describe("the turn-away sheet", () => {
  it("keeps the one available reason selected", () => {
    render(
      <TurnAwayForm
        action={vi.fn(async () => {})}
        bookingId="booking-a"
        reasons={[{ value: "identity", label: "Identity" }]}
        copy={copy}
      />,
    );
    expect(screen.getByRole("radio", { name: "Identity" })).toBeChecked();
  });

  /** Every sheet of the opened guest ends on its confirm and "Never mind" (Move, Cancel). */
  it("draws its dismiss beside the confirm", () => {
    render(
      <TurnAwayForm
        action={vi.fn(async () => {})}
        bookingId="booking-a"
        reasons={[
          { value: "identity", label: "Identity" },
          { value: "medical", label: "Medical" },
        ]}
        copy={copy}
        dismiss={<button type="button">Never mind</button>}
      />,
    );
    expect(screen.getByRole("radio", { name: "Identity" })).not.toBeChecked();
    const confirm = screen.getByRole("button", { name: copy.confirmAriaLabel });
    expect(confirm.parentElement).toContainElement(
      screen.getByRole("button", { name: "Never mind" }),
    );
  });
});
