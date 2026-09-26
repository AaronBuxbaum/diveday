// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoatStageLine } from "./BoatStageLine";
import { FollowShareRow } from "./FollowShareRow";

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
   * **One row, drawn once** (K-155). The boat's line and the share row under
   * it are the same anatomy — the boat mark on the sunken ground beside a
   * line and its detail — and were two hand copies of one class string that
   * differed in one word: this one's `items-start` hung its mark 20px above
   * the card's centre at 390, where the share row's is centred.
   */
  it("draws the same row as the share row beneath it, the mark centred on the words", () => {
    const { container } = render(
      <>
        <BoatStageLine sentence="Out on Molasses Reef." said="The crew said so at 7:04 AM." />
        <FollowShareRow
          url="https://example.test/s/blue-mantis/boats/mantis-ii"
          text="Mantis II's day"
          heading="Share with whoever is waiting for you"
          detail="A link to where the boat is, no names on it."
          action="Share"
          copied="Link copied"
          copyFailed="Could not copy"
        />
      </>,
    );
    const [stage, share] = Array.from(container.children);
    expect(stage.className).toBe(share.className);
    expect(stage).toHaveClass("items-center");
    expect(stage).not.toHaveClass("items-start");
  });

  it("spends no coral: the thread's three moments are booked, waiver and welcome home", () => {
    const source = readFileSync(path.join(__dirname, "BoatStageLine.tsx"), "utf8");
    expect(source).not.toMatch(/accent|EarnedMoment/);
  });
});
