// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { StaffingMyWeek } from "./StaffingMyWeek";
import { KEIKO, renderWeek, THURSDAY } from "./staffing-week-test-fixtures";

afterEach(cleanup);

describe("the phone calendar", () => {
  it("draws seven day cells, today open, each a link that keeps the day in the URL", () => {
    renderWeek();
    const nav = screen.getByRole("navigation", { name: "Who’s working" });
    const cells = within(nav).getAllByRole("link");
    expect(cells).toHaveLength(7);
    const open = cells.find((cell) => cell.getAttribute("aria-current") === "date");
    expect(open).toHaveAttribute(
      "href",
      `/shop/blue-mantis/staffing?week=2026-08-24&day=${THURSDAY}`,
    );
    expect(cells[0]).toHaveAttribute(
      "href",
      "/shop/blue-mantis/staffing?week=2026-08-24&day=2026-08-24",
    );
  });

  it("opens the day the reader chose and says so when it holds nothing", () => {
    renderWeek({ dayParam: "2026-08-25" });
    const nav = screen.getByRole("navigation", { name: "Who’s working" });
    const open = within(nav)
      .getAllByRole("link")
      .find((cell) => cell.getAttribute("aria-current") === "date");
    expect(open).toHaveAttribute("href", expect.stringContaining("day=2026-08-25"));
    expect(screen.getByText("Nothing scheduled this day")).toBeVisible();
  });
});

describe("your week on the Shifts tab", () => {
  const shift = {
    id: "shift-1",
    startsAt: new Date("2026-08-27T10:30:00.000Z"),
    endsAt: new Date("2026-08-27T16:00:00.000Z"),
    note: "Dock",
  };
  const render_ = (canManage: boolean, shifts = [shift], blocks = [] as never[]) =>
    render(
      <StaffingMyWeek
        shifts={shifts}
        blocks={blocks}
        locale="en-US"
        timeZone="America/New_York"
        canManage={canManage}
        t={staffTranslator("en-US")}
        deleteShiftAction={vi.fn()}
        deleteAwayAction={vi.fn()}
      />,
    );

  it("lists my shift and days off with doors to add more", () => {
    render_(true, [shift], [
      {
        id: "away-1",
        personId: KEIKO.personId,
        startsOn: "2026-08-29",
        endsOn: "2026-08-30",
        note: "Family",
      },
    ] as never[]);
    expect(screen.getByText("Dock")).toBeVisible();
    expect(screen.getByText("Family")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Add a shift" })).toHaveAttribute("href", "#add-shift");
    expect(screen.getByRole("link", { name: "Add days off" })).toHaveAttribute("href", "#add-away");
  });

  it("offers a crew member only the days-off door and no shift Remove", () => {
    render_(false);
    expect(screen.queryByRole("link", { name: "Add a shift" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("link", { name: "Add days off" })).toBeVisible();
  });

  it("says so when there is nothing", () => {
    render_(true, []);
    expect(screen.getByText("Nothing scheduled this week")).toBeVisible();
  });
});
