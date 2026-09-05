// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveBoatPanel } from "./LiveBoatPanel";

afterEach(cleanup);

/**
 * The one place a live operational fact reaches an anonymous visitor (ADR
 * 20260904-reef-all-the-way-down, Budget rule 4). What may be published is
 * decided by `liveShopStage`; what this holds is that the panel says what it
 * was given and claims nothing more.
 */
describe("LiveBoatPanel", () => {
  it("says where the boat is and when the crew said so", () => {
    render(
      <LiveBoatPanel
        stage="underway"
        eyebrow="Right now"
        sentence="Mantis II is out on Molasses Reef."
        meta="The crew said so at 7:04 AM. Back around 11:30 AM."
      />,
    );
    expect(screen.getByText("Mantis II is out on Molasses Reef.")).toBeInTheDocument();
    expect(screen.getByText(/The crew said so at 7:04 AM/)).toBeInTheDocument();
  });

  it("names no person and no position", () => {
    const { container } = render(
      <LiveBoatPanel
        stage="underway"
        eyebrow="Right now"
        sentence="Mantis II is out on Molasses Reef."
        meta="The crew said so at 7:04 AM."
      />,
    );
    // A visitor is told a boat is out, not who is on it or where it is.
    expect(container.textContent).not.toMatch(/\d+\.\d+°|lat|lon|position/i);
  });
});
