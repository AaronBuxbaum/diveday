// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { monthKey, monthLabel, monthsNewestFirst } from "@/lib/calendar";
import { MonthJump } from "./MonthJump";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => "/shop/blue-mantis/reports",
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

function months(locale: string) {
  return monthsNewestFirst({ year: 2025, month: 12 }, { year: 2026, month: 9 }).map((month) => ({
    value: monthKey(month),
    label: monthLabel(month, locale),
  }));
}

describe("the reports month list", () => {
  /**
   * **The month is the shop's words, not the browser's** (#1983). A native
   * `<input type="month">` drew "September 2026" in the browser's language
   * inside a fixed box, cut to "September 202" at 160px, and a Spanish
   * browser's "septiembre de 2026" fit no width the row could give at 390. A
   * select's options are the page's own labels, and it is as wide as the
   * longest of them, so the longest month in either bundle is whole.
   */
  it("offers each month in the shop's language, newest first, submitting YYYY-MM", () => {
    render(<MonthJump value="2026-03" months={months("es-ES")} label="Ir a un mes" />);
    const list = screen.getByLabelText("Ir a un mes");
    expect(list.tagName).toBe("SELECT");
    expect(list).toHaveAttribute("name", "month");
    expect(list).toHaveValue("2026-03");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("septiembre de 2026");
    expect(options[0]).toHaveValue("2026-09");
    expect(options.at(-1)).toHaveTextContent("diciembre de 2025");
    expect(options.at(-1)).toHaveValue("2025-12");
    expect(options).toHaveLength(10);
  });

  it("draws at the row's md height with no fixed width of its own", () => {
    render(<MonthJump value="2026-09" months={months("en-US")} label="Jump to a month" />);
    const list = screen.getByLabelText("Jump to a month");
    expect(list).toHaveClass("min-h-12");
    // No `w-40` / `w-44` box: the width that cut "September 2026" short.
    expect(list.className).not.toMatch(/\bw-(40|44)\b/);
    expect(list.parentElement?.className ?? "").not.toMatch(/\bw-(40|44)\b/);
    expect(screen.getByRole("option", { name: "September 2026" })).toBeInTheDocument();
  });

  it("goes to a picked month at once, and stays put when the same month is picked", () => {
    render(<MonthJump value="2026-09" months={months("en-US")} label="Jump to a month" />);
    const list = screen.getByLabelText("Jump to a month");
    fireEvent.change(list, { target: { value: "2026-09" } });
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(list, { target: { value: "2026-01" } });
    expect(push).toHaveBeenCalledWith("/shop/blue-mantis/reports?month=2026-01", { scroll: false });
  });
});
