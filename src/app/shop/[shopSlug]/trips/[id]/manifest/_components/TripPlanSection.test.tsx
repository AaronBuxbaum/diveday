// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripPlanSection } from "./TripPlanSection";

afterEach(cleanup);

const DIVES = [
  { diveNumber: 1, line: "Dive 1 · Molasses Reef" },
  { diveNumber: 2, line: "Dive 2 · French Reef" },
];

function plan(dives = DIVES) {
  return render(
    <TripPlanSection
      heading="The plan"
      dives={dives}
      doorLabel="Changed the plan?"
      doorNote="Record it on the dive log."
      doorHref="/shop/blue-mantis/trips/t1/manifest#log"
    />,
  );
}

describe("TripPlanSection", () => {
  it("names every planned dive in order", () => {
    const { container } = plan();
    const lines = [...container.querySelectorAll("li")].map((node) => node.textContent);
    expect(lines).toEqual(["Dive 1 · Molasses Reef", "Dive 2 · French Reef"]);
  });

  it("renders nothing at all when the day has no planned dives", () => {
    const { container } = plan([]);
    expect(container.firstElementChild).toBeNull();
  });

  it("keeps the plan off the printed sheet", () => {
    // The printed trip packet renders this whole manifest *and* its own
    // `PacketDives` list, so without `print:hidden` the sheet a crew carries to
    // the boat prints the dive plan twice — and the door beside it is a link to
    // a screen nobody can tap on paper. Caught by e2e/trips.spec.ts's packet
    // test, which found two "Dive 1 ·" on one page; pinned here so the next
    // reader does not have to learn it from a strict-mode violation.
    const { container } = plan();
    expect(container.querySelector("section")?.className).toContain("print:hidden");
  });

  it("offers the door as a link, never a control the packet could carry", () => {
    const { container } = plan();
    const section = container.querySelector("section");
    if (!section) throw new Error("expected the plan to render");
    expect(within(section).getByRole("link", { name: /Changed the plan/ })).toBeInTheDocument();
    expect(section.querySelectorAll("button, input, select, textarea")).toHaveLength(0);
  });
});
