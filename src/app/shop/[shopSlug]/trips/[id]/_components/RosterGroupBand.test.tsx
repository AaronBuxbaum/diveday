// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RosterGroup, RosterGroupBand } from "./RosterGroupBand";

afterEach(cleanup);

describe("RosterGroupBand and RosterGroup", () => {
  it("draws a band as the group's rule and its heading, with what it carries beside", () => {
    const { container } = render(
      <RosterGroupBand id="g" label="Ready · 2">
        <span>2 aboard</span>
      </RosterGroupBand>,
    );
    const band = container.querySelector("#g");
    expect(band).toHaveClass("border-t", "first:border-t-0", "scroll-mt-24");
    expect(within(band as HTMLElement).getByRole("heading", { name: "Ready · 2" })).toBeTruthy();
    expect(screen.getByText("2 aboard")).toBeTruthy();
  });

  it("draws a group's rule on the box, so its band carries none of its own", () => {
    const { container } = render(
      <RosterGroup id="add-diver" label="Add a diver" className="scroll-mt-24">
        <p>Find a returning diver</p>
      </RosterGroup>,
    );
    const group = container.querySelector("#add-diver");
    expect(group).toHaveClass("border-t", "first:border-t-0", "scroll-mt-24");
    const band = screen.getByRole("heading", { name: "Add a diver" }).parentElement;
    expect(band).not.toHaveClass("border-t");
  });
});
