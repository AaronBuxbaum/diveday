// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArrivalSearch } from "./ArrivalSearch";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis",
  useRouter: () => router,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const copy = {
  label: "Find an arriving diver",
  placeholder: "Name, email, or booking ID",
};

describe("ArrivalSearch", () => {
  it("applies a typed query after a short idle period", () => {
    vi.useFakeTimers();
    render(<ArrivalSearch query="" copy={copy} />);

    fireEvent.input(screen.getByRole("searchbox", { name: copy.label }), {
      target: { value: "not-a-real-diver" },
    });

    expect(router.replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(router.replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(router.replace).toHaveBeenCalledWith("/shop/blue-mantis?q=not-a-real-diver", {
      scroll: false,
    });
  });

  it("clears the lookup at once when the box is emptied", () => {
    render(<ArrivalSearch query="Nadia" copy={copy} />);
    fireEvent.input(screen.getByRole("searchbox", { name: copy.label }), { target: { value: "" } });
    expect(router.replace).toHaveBeenLastCalledWith("/shop/blue-mantis", { scroll: false });
  });

  /** Today is not the counter: the box must not steal focus from the page. */
  it("does not take focus on arrival", () => {
    render(<ArrivalSearch query="" copy={copy} />);
    expect(document.activeElement).not.toBe(screen.getByRole("searchbox", { name: copy.label }));
  });
});
