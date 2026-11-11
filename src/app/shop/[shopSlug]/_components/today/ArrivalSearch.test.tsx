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

  /** The arrival lookup opens ready for a name or scanner. */
  it("takes focus on arrival", () => {
    render(<ArrivalSearch query="" copy={copy} />);
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: copy.label }));
  });
  it("leaves focus alone while the booking panel is open", () => {
    render(
      <>
        <section id="call-panel">Add a booking</section>
        <ArrivalSearch query="" copy={copy} />
      </>,
    );
    expect(document.activeElement).toBe(document.body);
  });
  it("leaves focus alone while the requested booking panel is still streaming", () => {
    const originalUrl = window.location.href;
    window.history.replaceState({}, "", "/shop/blue-mantis?call=1");
    try {
      render(<ArrivalSearch query="" copy={copy} />);
      expect(document.activeElement).toBe(document.body);
    } finally {
      window.history.replaceState({}, "", originalUrl);
    }
  });
  it("does not steal focus from a control used before arrival search hydrates", () => {
    const link = document.createElement("a");
    link.href = "#departure";
    link.textContent = "Open departure";
    document.body.append(link);
    link.focus();
    try {
      render(<ArrivalSearch query="" copy={copy} />);
      expect(document.activeElement).toBe(link);
    } finally {
      link.remove();
    }
  });

  it("takes over the route heading's default focus on client navigation", () => {
    const { rerender } = render(
      <main>
        <h1 tabIndex={-1}>Today</h1>
      </main>,
    );
    screen.getByRole("heading", { name: "Today" }).focus();
    rerender(
      <main>
        <h1 tabIndex={-1}>Today</h1>
        <ArrivalSearch query="" copy={copy} />
      </main>,
    );
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: copy.label }));
  });
});
