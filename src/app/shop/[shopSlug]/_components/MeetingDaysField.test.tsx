// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MeetingDaysField } from "./MeetingDaysField";

afterEach(cleanup);

/**
 * **A date per later day** (third UX review, item 10), held back behind
 * `MAX_MEETING_DAY_GAP_DAYS` until Today and the roll call read a departure's
 * meeting days. Rendered here with `namedDates` so the boxes stay correct for
 * the day they are offered again.
 */
const copy = { daysLabel: "Days", daysDescription: "", dayLabel: "Day {number}" };

function renderField(props: { defaultCount: number; defaultLaterDates?: string[] }) {
  return render(
    <form>
      <input name="date" type="date" defaultValue="2026-10-03" />
      <MeetingDaysField copy={copy} minDays={1} maxDays={14} namedDates {...props} />
    </form>,
  );
}

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
