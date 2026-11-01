// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoatStageLine } from "./BoatStageLine";

afterEach(cleanup);

describe("BoatStageLine", () => {
  it("says the boat's line and the time the crew said it", () => {
    render(
      <BoatStageLine
        sentence="Two-Tank Reef is out on Molasses Reef."
        said="The crew said so at 7:04 AM."
      />,
    );
    expect(screen.getByText("Two-Tank Reef is out on Molasses Reef.")).toBeInTheDocument();
    expect(screen.getByText("The crew said so at 7:04 AM.")).toBeInTheDocument();
  });

  /**
   * **The mark centred on the words** (K-155): an `items-start` hung it 20px
   * above the card's centre at 390.
   */
  it("centers the mark on the words", () => {
    const { container } = render(
      <BoatStageLine sentence="Out on Molasses Reef." said="The crew said so at 7:04 AM." />,
    );
    const [stage] = Array.from(container.children);
    expect(stage).toHaveClass("items-center");
    expect(stage).not.toHaveClass("items-start");
  });

  it("keeps the boat mark neutral and does not spend an earned moment", () => {
    const { container } = render(
      <BoatStageLine sentence="Out on Molasses Reef." said="The crew said so at 7:04 AM." />,
    );
    const mark = container.querySelector('[data-site-mark="boat"] svg');
    expect(mark).toBeInTheDocument();
    expect(mark?.outerHTML).not.toMatch(/accent/);
    expect(container.querySelector("[class*='accent'], .rise-in")).toBeNull();
  });
});
