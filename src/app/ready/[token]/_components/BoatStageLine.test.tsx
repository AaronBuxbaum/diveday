// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
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

  it("spends no coral: the thread's three moments are booked, waiver and welcome home", () => {
    const source = readFileSync(path.join(__dirname, "BoatStageLine.tsx"), "utf8");
    expect(source).not.toMatch(/accent|EarnedMoment/);
  });
});
