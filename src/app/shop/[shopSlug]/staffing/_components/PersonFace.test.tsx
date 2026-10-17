// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonFace } from "./StaffingWeek";

afterEach(cleanup);

/** Fifth-loop ideas, item 52: the person's week in one figure under their name. */
describe("the staffing grid's name cell", () => {
  it("sets the week's figure under the name and roles", () => {
    render(
      <PersonFace
        person={{ name: "Keiko Tanaka", roles: ["Divemaster"] }}
        totals="6 days · 8 boats · 34 h"
      />,
    );
    expect(screen.getByText("Keiko Tanaka")).toBeTruthy();
    expect(screen.getByText("6 days · 8 boats · 34 h")).toBeTruthy();
  });

  it("says no figure for someone with nothing all week", () => {
    render(<PersonFace person={{ name: "Rafa Ortiz", roles: [] }} totals={undefined} />);
    expect(screen.queryByText(/ h$/)).toBeNull();
  });
});
