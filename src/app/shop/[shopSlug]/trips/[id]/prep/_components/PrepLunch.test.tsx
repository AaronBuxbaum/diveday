// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrepLunch } from "./PrepLunch";
import { everyPanelPrep, t, viewOf } from "./prep-test-fixtures";

afterEach(cleanup);

describe("PrepLunch", () => {
  it("says how many to feed and what each person can't eat, by name", () => {
    const prep = {
      ...everyPanelPrep(),
      lunch: { count: 14, notes: [{ name: "Ines Costa", note: "no shellfish" }] },
    };
    render(<PrepLunch view={viewOf(prep)} />);
    expect(screen.getByText(t("tripPrep.lunch.count", { count: 14 }))).toBeTruthy();
    expect(screen.getByText("Ines Costa: no shellfish")).toBeTruthy();
  });

  it("draws nothing where lunch is not served aboard", () => {
    const { container } = render(<PrepLunch view={viewOf({ ...everyPanelPrep(), lunch: null })} />);
    expect(container.innerHTML).toBe("");
  });
});
