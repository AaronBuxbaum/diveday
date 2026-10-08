// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DepartureDayNav, DepartureDaySteps } from "./DepartureDayNav";

afterEach(cleanup);

const words = { dayLabel: "Day", show: "Show" };
const steps = { earlier: "Earlier days", later: "Later days" };

describe("DepartureDayNav", () => {
  it("offers no Earlier days on today's window, and never a day before today", () => {
    render(
      <>
        <DepartureDayNav
          action="/shop/blue-mantis/bookings/new"
          day="2026-10-07"
          today="2026-10-07"
          request={null}
          words={words}
        />
        <DepartureDaySteps
          earlierHref={null}
          laterHref="/shop/blue-mantis/bookings/new?from=2026-10-09"
          words={steps}
        />
      </>,
    );
    expect(screen.queryByRole("link", { name: "Earlier days" })).toBeNull();
    expect(screen.getByRole("link", { name: "Later days" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/bookings/new?from=2026-10-09",
    );
    const day = screen.getByLabelText("Day");
    expect(day).toHaveAttribute("name", "from");
    expect(day).toHaveAttribute("min", "2026-10-07");
    expect(day).toHaveValue("2026-10-07");
  });

  it("carries the request being booked through a jump to another day", () => {
    const { container } = render(
      <>
        <DepartureDayNav
          action="/shop/blue-mantis/bookings/new"
          day="2026-10-20"
          today="2026-10-07"
          request="0b8a0c9e-0000-4000-8000-000000000001"
          words={words}
        />
        <DepartureDaySteps
          earlierHref="/shop/blue-mantis/bookings/new?from=2026-10-18"
          laterHref="/shop/blue-mantis/bookings/new?from=2026-10-22"
          words={steps}
        />
      </>,
    );
    expect(screen.getByRole("link", { name: "Earlier days" })).toBeInTheDocument();
    const hidden = container.querySelector('input[type="hidden"][name="request"]');
    expect(hidden).toHaveAttribute("value", "0b8a0c9e-0000-4000-8000-000000000001");
    expect(container.querySelector("form")).toHaveAttribute("method", "get");
  });
});
