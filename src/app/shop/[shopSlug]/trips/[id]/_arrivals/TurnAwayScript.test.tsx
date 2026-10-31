// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TurnAwayDoor, TurnAwayRowStateProvider, TurnAwayScript } from "./TurnAwayScript";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function row(bookingId: string) {
  return (
    <TurnAwayRowStateProvider>
      <TurnAwayDoor bookingId={bookingId} label="Turn away" />
      <TurnAwayScript
        action={vi.fn(async () => {})}
        bookingId={bookingId}
        reasons={[{ value: "identity", label: "Identity" }]}
        copy={{
          legend: "Reason",
          consequence: "The seat is released.",
          confirm: "Confirm turn-away",
          confirming: "Recording…",
          confirmAriaLabel: `Turn away ${bookingId}`,
          sendFailed: "Not sent. Retry.",
        }}
      />
    </TurnAwayRowStateProvider>
  );
}

describe("row-scoped turn-away controls", () => {
  it("opens only its own panel and keeps the one available reason selected", () => {
    render(
      <>
        {row("booking-a")}
        {row("booking-b")}
      </>,
    );

    const [firstDoor, secondDoor] = screen.getAllByRole("button", { name: "Turn away" });
    const firstPanel = document.getElementById("turn-away-booking-a");
    const secondPanel = document.getElementById("turn-away-booking-b");
    expect(firstPanel).toHaveAttribute("hidden");
    expect(secondPanel).toHaveAttribute("hidden");

    fireEvent.click(firstDoor);
    expect(firstDoor).toHaveAttribute("aria-expanded", "true");
    expect(firstDoor).toHaveAttribute("aria-controls", "turn-away-booking-a");
    expect(firstPanel).not.toHaveAttribute("hidden");
    expect(secondPanel).toHaveAttribute("hidden");
    expect(screen.getByRole("radio", { name: "Identity" })).toBeChecked();

    fireEvent.click(firstDoor);
    expect(firstPanel).toHaveAttribute("hidden");
    expect(secondDoor).toHaveAttribute("aria-expanded", "false");
  });
});
