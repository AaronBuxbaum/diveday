// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripPlanSection } from "./TripPlanSection";

afterEach(cleanup);

const DIVES = [
  { diveNumber: 1, line: "Dive 1 · Molasses Reef" },
  { diveNumber: 2, line: "Dive 2 · French Reef" },
];

function plan(dives = DIVES) {
  return render(<TripPlanSection heading="The plan" dives={dives} />);
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

  it("says where the boat meets before the dives, even on a day with none planned", () => {
    // UX review 2026-10-13, item 18: the crew read "The meeting point moved."
    // on the strip above, and no staff page said where it had moved to.
    const meeting = { label: "Where we meet", line: "Slip 4, the east dock · 1 Harbor Rd" };
    const { container } = render(
      <TripPlanSection heading="The plan" dives={DIVES} meeting={meeting} />,
    );
    const lines = [...container.querySelectorAll("li")].map((node) => node.textContent);
    expect(lines[0]).toBe("Where we meetSlip 4, the east dock · 1 Harbor Rd");
    expect(lines).toHaveLength(3);
    cleanup();
    const bare = render(<TripPlanSection heading="The plan" dives={[]} meeting={meeting} />);
    expect(bare.container.querySelectorAll("li")).toHaveLength(1);
  });

  it("keeps the plan off the printed sheet", () => {
    // The printed trip packet renders this whole manifest *and* its own
    // `PacketDives` list, so without `print:hidden` the sheet a crew carries to
    // the boat prints the dive plan twice. Caught by e2e/trips.spec.ts's packet
    // test, which found two "Dive 1 ·" on one page; pinned here so the next
    // reader does not have to learn it from a strict-mode violation.
    const { container } = plan();
    expect(container.querySelector("section")?.className).toContain("print:hidden");
  });

  it("carries no door and no sentence about the dive log", () => {
    // "Changed the plan? Say why in the dive log after each dive." stood under
    // the plan at the dock (UX audit 2026-10-07, item 3); the log is on the
    // checkpoint switch, at the checkpoint where a change is recorded.
    const { container } = plan();
    const section = container.querySelector("section");
    if (!section) throw new Error("expected the plan to render");
    expect(section.querySelectorAll("a, button, input, select, textarea")).toHaveLength(0);
    expect(section.textContent).not.toMatch(/dive log|Changed the plan/);
  });
});
