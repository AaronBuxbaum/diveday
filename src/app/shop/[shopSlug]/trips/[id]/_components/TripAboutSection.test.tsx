// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripAboutSection } from "./TripAboutSection";

afterEach(cleanup);

/**
 * Slice 5e's contract (ADR 20260827-the-departure-is-two-working-surfaces):
 * Overview's configuration is one compact About disclosure at rest, its
 * label/value rows and existing editors remain available on intent, and a
 * row anchor opens the parent disclosure so a client-side deep link does not
 * land on hidden work.
 */
describe("Trip About panel (slice 5e)", () => {
  const props = {
    heading: "About this departure",
    detailsLabel: "Details",
    closeLabel: "Close",
    editLabel: "Edit",
    summary: "Molasses Reef · Mantis II · Keiko",
    conditionsSummary: "Wind 10 kt SE · viz 60 ft",
    rows: [
      { label: "The plan", value: "Molasses Reef + Winch Hole", editHref: "#details" },
      { label: "Conditions", value: "Wind 10 kt SE · viz 60 ft", editHref: "#conditions" },
    ],
  };

  it("keeps configuration compact and hidden at rest", () => {
    const { container } = render(
      <TripAboutSection {...props}>
        <div>Details editor</div>
      </TripAboutSection>,
    );

    const about = container.querySelector("#about");
    expect(about).not.toHaveAttribute("open");
    expect(screen.getByText(props.summary)).toBeVisible();
    expect(screen.getAllByText(props.conditionsSummary)).toHaveLength(2);
    expect(screen.getByText("Details editor")).not.toBeVisible();
  });

  it("keeps the rows, actions, and editors available when opened", () => {
    render(
      <TripAboutSection {...props} open actions={<button type="button">View public page</button>}>
        <div>Details editor</div>
      </TripAboutSection>,
    );

    expect(screen.getByText("About this departure")).toBeVisible();
    expect(screen.getByText("Molasses Reef + Winch Hole")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Edit" })[0]).toHaveAttribute("href", "#details");
    expect(screen.getByRole("button", { name: "View public page" })).toBeVisible();
    expect(screen.getByText("Details editor")).toBeVisible();
  });
});
