// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripDiveFields, type TripDiveFieldsCopy } from "./TripDiveFields";

afterEach(cleanup);

const COPY: TripDiveFieldsCopy = {
  heading: "Dive plan",
  description: "Leaving a dive blank is okay. Divers will still see {tripShape}.",
  twoTankTrip: "a clear two-tank trip plan",
  diveCountTripOne: "a {count}-dive trip plan",
  diveCountTripOther: "a {count}-dive trip plan",
  numberOfDivesLabel: "Number of dives",
  diveOptionOne: "{count} dive",
  diveOptionOther: "{count} dives",
  diveLegend: "Dive {number}",
  nameLabel: "Name",
  optionalHint: "optional",
  namePlaceholderFirst: "Molasses Reef",
  namePlaceholderOther: "Christ of the Abyss",
  diveSiteLabel: "Dive site",
  noSiteChosen: "No site chosen yet",
  travelLabelFirst: "Minutes out from the dock",
  travelLabelOther: "Minutes from the last site",
  travelHint: "blank uses your usual ride out",
  diverFacingDetailsLabel: "What divers should know",
  footerNote: "Divers see these on their trip page.",
};

function frame() {
  return screen.getByRole("heading", { name: "Dive plan" }).closest("section");
}

/**
 * **The Dive plan is drawn like the groups around it, on whichever form it
 * sits in.** It hard-coded a 20px panel corner and a 16px phone inset, where
 * the schedule builder's other groups are 12px-cornered fieldsets inset 20px
 * and the trip page's are sunken insets: in the builder a 20px corner sat
 * inside a 12px add panel, and its title started 4px nearer its border than
 * Pay at booking's and Repeat's (pixel-craft K-95).
 */
describe("the Dive plan's frame", () => {
  it.each([
    ["the trip page's sunken inset", "rounded-inset bg-surface-sunken p-4 sm:p-5"],
    ["the builder's fieldset", "rounded-lg border border-border bg-surface p-5"],
  ])("takes the caller's frame whole: %s", (_, frameClassName) => {
    render(<TripDiveFields diveSites={[]} copy={COPY} frameClassName={frameClassName} />);

    expect(frame()?.getAttribute("class")).toBe(frameClassName);
  });
});

/**
 * A line the caller has about dive one's site (the schedule builder's tide at
 * the chosen site) is that select's own description: under its box, in a
 * field description's type, and read with it (pixel-craft K-337). Only dive
 * one's, the site `onFirstDiveSiteChange` reports.
 */
describe("dive one's site description", () => {
  const sites = [{ id: "molasses", name: "Molasses Reef" }];
  const describedBy = (control: Element | null) =>
    (control?.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "");

  it("describes dive one's site select, and no other dive's", () => {
    const { container } = render(
      <TripDiveFields
        diveSites={sites}
        copy={COPY}
        frameClassName=""
        firstDiveSiteDescription="Next high water at 9:12 AM."
      />,
    );

    expect(describedBy(container.querySelector('select[name="dive-1-siteId"]'))).toEqual([
      "Next high water at 9:12 AM.",
    ]);
    expect(
      container.querySelector('select[name="dive-2-siteId"]')?.getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("describes nothing while there is nothing to say", () => {
    const { container } = render(
      <TripDiveFields
        diveSites={sites}
        copy={COPY}
        frameClassName=""
        firstDiveSiteDescription={null}
      />,
    );

    expect(
      container.querySelector('select[name="dive-1-siteId"]')?.getAttribute("aria-describedby"),
    ).toBeNull();
  });
});
