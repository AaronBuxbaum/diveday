// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleFilters, type ScheduleFiltersCopy } from "./ScheduleFilters";

vi.mock("next/navigation", () => ({
  usePathname: () => "/s/blue-mantis",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const copy: ScheduleFiltersCopy = {
  disclosure: "More filters",
  tripType: "Trip type",
  allTrips: "All trips",
  funDive: "Fun dive",
  course: "Course",
  hasSpace: "Has space",
  canDive: "What can you dive?",
  canDiveUnsaid: "Not saying",
  canDiveLevels: [{ value: "open_water", label: "Open Water" }],
  hideAboveLevel: "Hide trips above my level",
};

function filters(canDiveFilter: string | null = "open_water") {
  return render(
    <ScheduleFilters
      embed={false}
      month={null}
      lens={null}
      tripTypeFilter={null}
      hasSpaceFilter={false}
      canDiveFilter={canDiveFilter}
      hideAboveFilter={false}
      copy={copy}
    />,
  );
}

/**
 * **On a phone the filters stand in one column** (pixel-craft K-559). The
 * row wrapped by the selects' own widths: at 390 the two selects ended 49px
 * apart (x 175 and 224), the first checkbox rode up beside the second at
 * x 237, and the form packed into three ragged rows. Below `sm` the row is a
 * column, each select the form's full width and the checkboxes under them.
 */
describe("the filter form's layout", () => {
  it("is a column below sm, every control the form's width", () => {
    const { container } = filters();
    const row = screen.getByRole("combobox", { name: "Trip type" }).closest("[id] > div");

    expect(row).toBe(container.querySelector("form > div[id] > div"));
    expect(row).toHaveClass("flex", "flex-wrap", "max-sm:flex-col", "max-sm:items-stretch");
  });

  it("keeps all four controls in that one column", () => {
    filters();
    const row = screen.getByRole("combobox", { name: "Trip type" }).closest("[id] > div");

    for (const control of [
      screen.getByRole("combobox", { name: "What can you dive?" }),
      screen.getByRole("checkbox", { name: "Has space" }),
      screen.getByRole("checkbox", { name: "Hide trips above my level" }),
    ]) {
      expect(control.closest("[id] > div")).toBe(row);
    }
  });
});

/**
 * **One row, one toggle** (visual review 2026-10-24, B18/B35): the filters
 * sit beside the chips and the month rail, and "More filters" opens the
 * panel under that row. The toggle names its panel and says whether it is
 * open, as the old `<details>` did by itself.
 */
describe("the More filters toggle", () => {
  it("opens and closes the panel it controls", () => {
    filters(null);
    const toggle = screen.getByRole("button", { name: "More filters" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");

    expect(panel).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("hidden");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
  });

  it("starts open while a filter is set", () => {
    filters("open_water");
    expect(screen.getByRole("button", { name: "More filters" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
