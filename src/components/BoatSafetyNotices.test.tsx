// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoatSafetyNotices } from "./BoatSafetyNotices";

afterEach(cleanup);

const HEADING = "Mantis I: papers and safety kit";

describe("BoatSafetyNotices", () => {
  it("renders nothing for a boat with nothing to say", () => {
    const { container } = render(<BoatSafetyNotices heading={HEADING} lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws missing kit and too many aboard in danger ink, and the panel with them", () => {
    render(
      <BoatSafetyNotices
        heading={HEADING}
        lines={[
          { text: "No emergency oxygen aboard", tone: "danger" },
          { text: "Flares: expired 3 days ago", tone: "warning" },
          { text: "AED: pads expire in 12 days", tone: "neutral" },
        ]}
      />,
    );
    const section = screen.getByRole("region", { name: HEADING });
    expect(section.className).toContain("bg-danger/10");
    expect(screen.getByText("No emergency oxygen aboard").className).toContain(
      "text-danger-strong",
    );
    expect(screen.getByText("Flares: expired 3 days ago").className).toContain(
      "text-warning-strong",
    );
    expect(screen.getByText("AED: pads expire in 12 days").className).toContain("text-muted");
  });

  it("is a warning card when the worst line has lapsed, and plain when all are merely due", () => {
    const { rerender } = render(
      <BoatSafetyNotices
        heading={HEADING}
        lines={[{ text: "Flares: expired 3 days ago", tone: "warning" }]}
      />,
    );
    expect(screen.getByRole("region", { name: HEADING }).className).toContain("bg-warning/10");
    rerender(
      <BoatSafetyNotices
        heading={HEADING}
        lines={[{ text: "Insurance expires in 21 days", tone: "neutral" }]}
      />,
    );
    const plain = screen.getByRole("region", { name: HEADING }).className;
    expect(plain).not.toContain("bg-warning/10");
    expect(plain).not.toContain("bg-danger/10");
  });

  it("is on the printed sheet: nothing in it is print-hidden", () => {
    // The sheet the boat carries is this page printed; the after-dive controls
    // around it are `print:hidden`, and this section must never join them.
    const { container } = render(
      <BoatSafetyNotices heading={HEADING} lines={[{ text: "No AED aboard", tone: "danger" }]} />,
    );
    expect(container.querySelector("[class*='print:hidden']")).toBeNull();
    expect(container.querySelector("[class*='hidden']")).toBeNull();
  });
});
