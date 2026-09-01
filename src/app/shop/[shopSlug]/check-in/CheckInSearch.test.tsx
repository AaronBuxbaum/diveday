// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckInSearch } from "./CheckInSearch";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/check-in",
  useRouter: () => router,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const copy = {
  label: "Scan or search diver",
  placeholder: "Name, email, or booking ID",
};

describe("CheckInSearch", () => {
  it("applies a typed query after a short idle period instead of leaving the full queue visible", () => {
    vi.useFakeTimers();
    render(<CheckInSearch query="" trip={undefined} copy={copy} />);

    fireEvent.input(screen.getByRole("searchbox", { name: copy.label }), {
      target: { value: "not-a-real-diver" },
    });

    expect(router.replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(router.replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(router.replace).toHaveBeenCalledWith("/shop/blue-mantis/check-in?q=not-a-real-diver", {
      scroll: false,
    });
  });

  /**
   * **The counter's most frequent gesture must not re-point the instrument.**
   * `QueryForm` rebuilds the query string from this form's own fields, so
   * `?trip=` — which the departure chips wrote and this box knows nothing about
   * — is dropped unless it is `keep`t. Without it a staffer taps the 1:00 PM
   * chip, types a name and clears the box, and lands on whatever
   * `selectFocusedDeparture` picks by default: a different boat's head count,
   * with nothing on screen saying the boat changed (`./focus.ts`).
   */
  it("carries the focused departure through a search and back out of it", () => {
    vi.useFakeTimers();
    const { rerender } = render(<CheckInSearch query="" trip="trip-afternoon" copy={copy} />);

    fireEvent.input(screen.getByRole("searchbox", { name: copy.label }), {
      target: { value: "Nadia" },
    });
    vi.advanceTimersByTime(300);
    expect(router.replace).toHaveBeenCalledWith(
      "/shop/blue-mantis/check-in?trip=trip-afternoon&q=Nadia",
      { scroll: false },
    );

    // Clearing the box submits immediately — and still on the same boat.
    rerender(<CheckInSearch query="Nadia" trip="trip-afternoon" copy={copy} />);
    fireEvent.input(screen.getByRole("searchbox", { name: copy.label }), { target: { value: "" } });
    expect(router.replace).toHaveBeenLastCalledWith(
      "/shop/blue-mantis/check-in?trip=trip-afternoon",
      { scroll: false },
    );
  });
});
