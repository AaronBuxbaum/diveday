// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MeetingDaysField } from "./MeetingDaysField";

afterEach(cleanup);

/**
 * **A date and hours per later day** (third UX review, item 10; #2557,
 * #2558). Today and the roll call read a departure's meeting days, so the
 * boxes are offered by default; a gap between days is a date changed here.
 */
const copy = {
  daysLabel: "Days",
  daysDescription: "",
  dayLabel: "Day {number}",
  dayStartLabel: "Day {number} departs",
  dayEndLabel: "Day {number} returns",
};

function renderField(props: {
  defaultCount: number;
  defaultLaterDates?: string[];
  defaultLaterHours?: { start: string; end: string }[];
}) {
  return render(
    <form>
      <input name="date" type="date" defaultValue="2026-10-03" />
      <input name="startTime" type="time" defaultValue="08:00" />
      <input name="endTime" type="time" defaultValue="16:00" />
      <MeetingDaysField copy={copy} minDays={1} maxDays={14} {...props} />
    </form>,
  );
}

const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe("MeetingDaysField with named dates", () => {
  it("shows each later day's own date, and moves them with day one", async () => {
    renderField({ defaultCount: 3, defaultLaterDates: ["2026-10-04", "2026-10-10"] });
    const day2 = (await screen.findByLabelText("Day 2")) as HTMLInputElement;
    const day3 = screen.getByLabelText("Day 3") as HTMLInputElement;
    expect(day2.value).toBe("2026-10-04");
    expect(day3.value).toBe("2026-10-10");
    expect(day2.name).toBe("meetingDate");

    const first = document.querySelector('input[name="date"]') as HTMLInputElement;
    fireEvent.change(first, { target: { value: "2026-10-10" } });
    expect((screen.getByLabelText("Day 2") as HTMLInputElement).value).toBe("2026-10-11");
    expect((screen.getByLabelText("Day 3") as HTMLInputElement).value).toBe("2026-10-17");
  });

  it("offers the next consecutive date for a day the count adds", async () => {
    renderField({ defaultCount: 1 });
    expect(screen.queryByLabelText("Day 2")).toBeNull();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Days/ }), { target: { value: "2" } });
    expect(((await screen.findByLabelText("Day 2")) as HTMLInputElement).value).toBe("2026-10-04");
  });
});

describe("MeetingDaysField with a gap and a day's own hours", () => {
  it("offers the date boxes by default and keeps a two-week gap", async () => {
    renderField({ defaultCount: 2 });
    const day2 = (await screen.findByLabelText("Day 2")) as HTMLInputElement;
    expect(day2.value).toBe("2026-10-04");
    fireEvent.change(day2, { target: { value: "2026-10-17" } });
    expect(value("Day 2")).toBe("2026-10-17");
    // Moving day one keeps the fortnight.
    const first = document.querySelector('input[name="date"]') as HTMLInputElement;
    fireEvent.change(first, { target: { value: "2026-10-10" } });
    expect(value("Day 2")).toBe("2026-10-24");
  });

  it("gives each later day the form's hours until one is changed", async () => {
    renderField({ defaultCount: 3 });
    await screen.findByLabelText("Day 2 departs");
    expect([value("Day 2 departs"), value("Day 2 returns")]).toEqual(["08:00", "16:00"]);
    fireEvent.change(screen.getByLabelText("Day 3 departs"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("Day 3 returns"), { target: { value: "21:00" } });
    const start = document.querySelector('input[name="startTime"]') as HTMLInputElement;
    fireEvent.change(start, { target: { value: "07:30" } });
    expect(value("Day 2 departs")).toBe("07:30");
    expect([value("Day 3 departs"), value("Day 3 returns")]).toEqual(["18:00", "21:00"]);
    expect(
      [...document.querySelectorAll<HTMLInputElement>('input[name="meetingStart"]')].map(
        (input) => input.value,
      ),
    ).toEqual(["07:30", "18:00"]);
  });

  it("seeds a stored day's own hours, and a day that kept day one's follows it", async () => {
    renderField({
      defaultCount: 3,
      defaultLaterDates: ["2026-10-04", "2026-10-10"],
      defaultLaterHours: [
        { start: "08:00", end: "16:00" },
        { start: "18:00", end: "21:00" },
      ],
    });
    await screen.findByLabelText("Day 3 departs");
    expect(value("Day 3 departs")).toBe("18:00");
    const end = document.querySelector('input[name="endTime"]') as HTMLInputElement;
    fireEvent.change(end, { target: { value: "15:00" } });
    expect(value("Day 2 returns")).toBe("15:00");
    expect(value("Day 3 returns")).toBe("21:00");
  });
});
