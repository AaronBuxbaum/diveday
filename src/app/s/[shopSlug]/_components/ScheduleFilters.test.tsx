// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleFilters, type ScheduleFiltersCopy } from "./ScheduleFilters";

vi.mock("next/navigation", () => ({
  usePathname: () => "/s/blue-mantis",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const copy: ScheduleFiltersCopy = {
  disclosure: "Filter",
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
    const row = screen.getByRole("combobox", { name: "Trip type" }).closest("details > div");

    expect(row).toBe(container.querySelector("details > div"));
    expect(row).toHaveClass("flex", "flex-wrap", "max-sm:flex-col", "max-sm:items-stretch");
  });

  it("keeps all four controls in that one column", () => {
    filters();
    const row = screen.getByRole("combobox", { name: "Trip type" }).closest("details > div");

    for (const control of [
      screen.getByRole("combobox", { name: "What can you dive?" }),
      screen.getByRole("checkbox", { name: "Has space" }),
      screen.getByRole("checkbox", { name: "Hide trips above my level" }),
    ]) {
      expect(control.closest("details > div")).toBe(row);
    }
  });
});
