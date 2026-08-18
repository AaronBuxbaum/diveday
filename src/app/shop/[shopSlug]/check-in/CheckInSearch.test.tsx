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
  submit: "Search",
};

describe("CheckInSearch", () => {
  it("applies a typed query after a short idle period instead of leaving the full queue visible", () => {
    vi.useFakeTimers();
    render(<CheckInSearch query="" copy={copy} />);

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
});
