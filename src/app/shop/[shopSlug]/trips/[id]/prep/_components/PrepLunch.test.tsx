// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrepLunch } from "./PrepLunch";
import { everyPanelPrep, t, viewOf } from "./prep-test-fixtures";

afterEach(cleanup);

describe("PrepLunch", () => {
  it("says how many to feed and each person's lunch note, by name", () => {
    const prep = {
      ...everyPanelPrep(),
      lunch: {
        count: 14,
        notes: [{ name: "Ines Costa", note: "vegetarian" }],
        answered: 1,
        asked: 12,
      },
    };
    render(<PrepLunch view={viewOf(prep)} />);
    expect(screen.getByText(t("tripPrep.lunch.count", { count: 14 }))).toBeTruthy();
    expect(screen.getByText("Ines Costa: vegetarian")).toBeTruthy();
    expect(screen.getByText("1 of 12 left a lunch note")).toBeTruthy();
  });

  it("with no notes says how many answered, never that nobody has a restriction", () => {
    const prep = { ...everyPanelPrep(), lunch: { count: 14, notes: [], answered: 0, asked: 12 } };
    render(<PrepLunch view={viewOf(prep)} />);
    expect(screen.getByText("0 of 12 left a lunch note")).toBeTruthy();
    expect(screen.queryByText(/nobody/i)).toBeNull();
  });

  it("draws nothing where lunch is not served aboard", () => {
    const { container } = render(<PrepLunch view={viewOf({ ...everyPanelPrep(), lunch: null })} />);
    expect(container.innerHTML).toBe("");
  });
});
