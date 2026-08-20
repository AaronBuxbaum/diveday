// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RepeatFields, type RepeatFieldsCopy } from "./RepeatFields";

afterEach(cleanup);

const copy: RepeatFieldsCopy = {
  howOftenLabel: "How often",
  doesntRepeat: "Doesn't repeat",
  everyWeek: "Every week",
  every2Weeks: "Every 2 weeks",
  every4Weeks: "Every 4 weeks",
  repeatsOnLabel: "Repeats on",
  everyDay: "Every day",
  endsLabel: "Ends",
  endsNever: "Keeps repeating",
  endsOnChoice: "On a date",
  endsOnLabel: "End date",
  weekdayNames: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

function renderFields() {
  return render(<RepeatFields startDate="2026-08-21" copy={copy} />);
}

describe("RepeatFields", () => {
  it("does not show a weekday selected while the form does not repeat", () => {
    renderFields();

    expect(screen.getByLabelText("How often")).toHaveValue("0");
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }
  });

  it("seeds the departure weekday only after repeating is chosen", async () => {
    const user = userEvent.setup();
    renderFields();

    await user.selectOptions(screen.getByLabelText("How often"), "1");

    expect(screen.getByRole("checkbox", { name: "Friday" })).toBeChecked();
  });

  it("clears a weekday selection when repeating is turned off again", async () => {
    const user = userEvent.setup();
    renderFields();

    await user.selectOptions(screen.getByLabelText("How often"), "1");
    await user.selectOptions(screen.getByLabelText("How often"), "0");

    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }
  });

  it("clears a bounded end date when repeating is turned off", async () => {
    const user = userEvent.setup();
    renderFields();

    await user.selectOptions(screen.getByLabelText("How often"), "1");
    await user.selectOptions(screen.getByLabelText("Ends"), "on");
    expect(screen.getByLabelText("End date")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("How often"), "0");

    expect(screen.queryByLabelText("End date")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ends")).toHaveValue("never");
  });
});
