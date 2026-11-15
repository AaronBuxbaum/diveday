// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonFace, WEEK_GRID } from "./StaffingWeek";

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

it("uses a compact, content-growing crew row rather than reserving 128px per person", () => {
  expect(WEEK_GRID.day).toContain("min-h-20");
  expect(WEEK_GRID.day).not.toContain("min-h-32");
});
it("shows an optional portrait beside the full name, without repeating it to screen readers", () => {
  const { container } = render(
    <PersonFace
      person={{ name: "Keiko Tanaka", roles: [], photoUrl: "/staff/keiko.webp" }}
      totals={undefined}
    />,
  );
  expect(container.querySelector("img")).toHaveAttribute("alt", "");
  expect(screen.getByText("Keiko Tanaka")).toBeTruthy();
});
it("keeps printed names ink-light even when a portrait exists", () => {
  const { container } = render(
    <PersonFace
      person={{ name: "Keiko Tanaka", roles: [], photoUrl: "/staff/keiko.webp" }}
      totals={undefined}
      print
    />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("Keiko Tanaka")).toBeTruthy();
});
