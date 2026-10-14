// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { OurYearPanel, ourYearSentence } from "./OurYear";

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

describe("ourYearSentence", () => {
  const t = diverTranslator("en-US");
  const full = "338 divers. 45 boats out. 7 reefs and wrecks.";

  it("names the sites once there are enough to be believed", () => {
    expect(ourYearSentence({ siteCount: 7, divers: 338, boatsOut: 45 }, full, t)).toBe(full);
  });

  it.each([0, 1])("leaves the sites out at %i, where the count reads as broken", (siteCount) => {
    const sentence = ourYearSentence({ siteCount, divers: 338, boatsOut: 45 }, full, t);
    expect(sentence).toContain("338");
    expect(sentence).not.toMatch(/reef|wreck/);
  });
});
