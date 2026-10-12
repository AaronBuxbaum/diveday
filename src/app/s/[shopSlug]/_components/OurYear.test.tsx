// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OurYearPanel } from "./OurYear";

afterEach(cleanup);

describe("OurYearPanel", () => {
  it("names the year, its range and its one sentence of counts", () => {
    render(
      <OurYearPanel
        heading="Our year"
        range="2026 · to October 12"
        sentence="312 divers. 140 boats out. 18 reefs and wrecks."
      />,
    );
    expect(screen.getByRole("region", { name: "Our year" })).toBeInTheDocument();
    expect(screen.getByText("2026 · to October 12")).toBeInTheDocument();
    expect(screen.getByText("312 divers. 140 boats out. 18 reefs and wrecks.")).toBeInTheDocument();
  });
});
