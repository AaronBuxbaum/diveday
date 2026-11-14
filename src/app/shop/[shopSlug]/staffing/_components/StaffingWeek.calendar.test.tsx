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
  const days = [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ].map((date) => ({ date, label: date, isToday: false }));
  const shift = {
    id: "shift-1",
    startsAt: new Date("2026-08-27T10:30:00.000Z"),
    endsAt: new Date("2026-08-27T16:00:00.000Z"),
    note: "Dock",
  };
  const away = (
    status: "pending" | "approved" | "declined",
    decisionNote: string | null = null,
  ) => ({
    id: `away-${status}`,
    personId: KEIKO.personId,
    startsOn: "2026-08-29",
    endsOn: "2026-08-30",
    note: "Family",
    status,
    decisionNote,
  });
  const render_ = (blocks: ReturnType<typeof away>[] = [], approvalRequired = false) =>
    render(
      <StaffingMyWeek
        days={days}
        shifts={[shift]}
        blocks={blocks}
        locale="en-US"
        timeZone="America/New_York"
        selfId={KEIKO.personId}
        approvalRequired={approvalRequired}
        t={staffTranslator("en-US")}
        createShiftAction={vi.fn()}
        saveAwayAction={vi.fn()}
        deleteShiftAction={vi.fn()}
        deleteAwayAction={vi.fn()}
      />,
    );

  it("lists each day with my shift, and an Add on every day", () => {
    render_();
    expect(screen.getByText("Dock")).toBeVisible();
    expect(screen.getAllByText("Add")).toHaveLength(7);
  });

  it("says where a day off stands, and why when it was declined", () => {
    render_([away("declined", "Short-staffed")]);
    expect(screen.getAllByText("Declined").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Why: Short-staffed").length).toBeGreaterThan(0);
  });

  it("marks a day off waiting for an owner as waiting", () => {
    render_([away("pending")], true);
    expect(screen.getAllByText("Waiting for an OK").length).toBeGreaterThan(0);
  });
});
