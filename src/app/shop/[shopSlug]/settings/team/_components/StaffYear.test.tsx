// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { StaffYearLine } from "./StaffYear";

const t = staffTranslator("en-US");

/** Fifth loop, item 32: a teammate's year, under their name. */
describe("StaffYearLine", () => {
  it("says the cards issued and the days at sea", () => {
    render(<StaffYearLine year={{ certified: 4, daysAtSea: 38 }} t={t} />);
    expect(screen.getByText("4 certifications issued this year · 38 days at sea")).toBeInTheDocument();
  });

  it("drops a half that is none, and says nothing for somebody with neither", () => {
    const { container, unmount } = render(
      <StaffYearLine year={{ certified: 0, daysAtSea: 1 }} t={t} />,
    );
    // The count keeps its noun with a no-break space.
    expect(container.textContent).toMatch(/^1\sday at sea$/u);
    unmount();
    const empty = render(<StaffYearLine year={{ certified: 0, daysAtSea: 0 }} t={t} />);
    expect(empty.container.textContent).toBe("");
  });
});
