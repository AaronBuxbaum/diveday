// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { BadgeWall } from "./BadgeWall";

const t = diverTranslator("en-US");

describe("BadgeWall", () => {
  it("renders nothing for a shop with no badges and no opening year", () => {
    const { container } = render(<BadgeWall badges={[]} establishedYear={null} t={t} />);
    expect(container.innerHTML).toBe("");
  });

  it("keeps the shop's order, in the reader's words, with the year first", () => {
    render(<BadgeWall badges={["blue_star", "padi_5_star"]} establishedYear={1998} t={t} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent?.trim());
    expect(items).toEqual(["Since 1998", "Blue Star Operator", "PADI 5 Star Dive Center"]);
  });

  it("draws a glyph, never an agency's image", () => {
    const { container } = render(
      <BadgeWall badges={["tripadvisor"]} establishedYear={null} t={t} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("draws the shield on its ink, so the pill's padding reads the same either side", () => {
    // In a 16-unit square the ink started 2px inside the box, and the glyph
    // side of each pill measured 14px to the border against the text's 11–12
    // (pixel-craft K-561). Cropped across to the ink at the stroke it is drawn
    // in, and sized by height, the box is the ink.
    const { container } = render(
      <BadgeWall badges={["padi_5_star"]} establishedYear={null} t={t} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "3.3 0 17.4 24");
    expect(svg).toHaveClass("h-3.5", "w-auto");
  });
});
