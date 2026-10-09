// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoatSafetyNotices } from "./BoatSafetyNotices";

afterEach(cleanup);

describe("BoatSafetyNotices", () => {
  it("renders nothing for a boat with nothing to say", () => {
    const { container } = render(<BoatSafetyNotices heading="Aboard Mantis I" lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the boat and lists every line, the lapsed ones in warning ink", () => {
    render(
      <BoatSafetyNotices
        heading="Aboard Mantis I"
        lines={[
          { text: "Flares: expired 3 days ago", urgent: true },
          { text: "AED: pads expire in 12 days", urgent: false },
        ]}
      />,
    );
    const section = screen.getByRole("region", { name: "Aboard Mantis I" });
    expect(section.className).toContain("bg-warning/10");
    expect(screen.getByText("Flares: expired 3 days ago").className).toContain(
      "text-warning-strong",
    );
    expect(screen.getByText("AED: pads expire in 12 days").className).toContain("text-muted");
  });

  it("stays a plain card when everything is merely coming due", () => {
    render(
      <BoatSafetyNotices
        heading="Aboard Mantis I"
        lines={[{ text: "Insurance expires in 21 days", urgent: false }]}
      />,
    );
    expect(screen.getByRole("region", { name: "Aboard Mantis I" }).className).not.toContain(
      "bg-warning/10",
    );
  });
});
