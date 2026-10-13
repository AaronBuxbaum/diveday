// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RosterGroup, RosterGroupBand } from "./RosterGroupBand";
import { fixtures, renderRoster } from "./roster-test-fixtures";

afterEach(cleanup);

describe("the roster's row geometry", () => {
  /**
   * K-354: every group band opens with a hairline except "ADD A DIVER". The
   * band draws `border-t … first:border-t-0`, and the add-diver band sat
   * first inside the `#add-diver` wrapper, so `first:` stripped its rule
   * though it is the card's last group. The group's rule is drawn by the
   * element that is the card's child: the band, or the box holding it.
   */
  it("opens the add-diver group with the same rule as every other group", () => {
    const { container } = renderRoster({
      ...fixtures,
      addDiverGroup: <p>Find a returning diver</p>,
    });

    const addDiver = container.querySelector("#add-diver");
    const ready = screen.getByRole("heading", { name: "Ready · 1" }).parentElement;
    // Siblings in the card, each drawing the rule between groups.
    expect(addDiver?.parentElement).toBe(ready?.parentElement);
    for (const group of [addDiver, ready]) {
      expect(group).toHaveClass("border-t", "first:border-t-0");
    }
    // The band inside the add-diver box draws none of its own.
    const band = within(addDiver as HTMLElement).getByRole("heading", {
      name: "Add a diver",
    }).parentElement;
    expect(band).not.toBe(addDiver);
    expect(band).not.toHaveClass("border-t");
  });
});

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
      <RosterGroup id="add-diver" label="Add a diver" className="print:hidden">
        <p>Find a returning diver</p>
      </RosterGroup>,
    );
    const group = container.querySelector("#add-diver");
    expect(group).toHaveClass("border-t", "first:border-t-0", "print:hidden");
    const band = screen.getByRole("heading", { name: "Add a diver" }).parentElement;
    expect(band).not.toHaveClass("border-t");
  });
});
