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
});
