// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripSitePeek } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { DiveSitesPeek } from "./DiveSitesPeek";

afterEach(cleanup);

const t = diverTranslator("en-US");

function site(overrides: Partial<TripSitePeek> = {}): TripSitePeek {
  return {
    name: "French Reef",
    description: null,
    difficultyLevel: "beginner",
    depthRange: null,
    depthMinMeters: null,
    maxDepthMeters: null,
    imageUrls: [],
    ...overrides,
  };
}

describe("DiveSitesPeek", () => {
  it("prints a site's depth in the shop's own unit", () => {
    const sites = [site({ depthMinMeters: 6, maxDepthMeters: 18 })];
    const { rerender } = render(
      <DiveSitesPeek sites={sites} heading="Sites" depthUnit="meters" t={t} />,
    );
    expect(screen.getByText("6–18 m · Beginner")).toBeInTheDocument();
    rerender(<DiveSitesPeek sites={sites} heading="Sites" depthUnit="feet" t={t} />);
    expect(screen.getByText("20–59 ft · Beginner")).toBeInTheDocument();
  });

  it("falls back to the shop's note only where no depth is recorded", () => {
    render(
      <DiveSitesPeek
        sites={[site({ depthRange: "shallow ledge to 18" })]}
        heading="Sites"
        depthUnit="feet"
        t={t}
      />,
    );
    expect(screen.getByText("shallow ledge to 18 · Beginner")).toBeInTheDocument();
  });
});
