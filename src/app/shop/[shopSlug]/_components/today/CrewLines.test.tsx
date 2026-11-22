// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CrewReading } from "@/features/day/today";
import { staffTranslator } from "@/i18n/staff-messages";
import { CrewLines } from "./CrewLines";

afterEach(cleanup);

const t = staffTranslator("en-US");
const NONE: CrewReading = { tipsCents: 0, thanks: [], month: null };

function renderLines(crew: CrewReading) {
  return render(<CrewLines crew={crew} currency="USD" locale="en-US" t={t} />);
}

describe("CrewLines", () => {
  it("draws nothing at all when the reader has nothing to read, so the spine keeps no empty slot", () => {
    const { container } = renderLines(NONE);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the tips and the month together in one block", () => {
    const { container } = renderLines({
      ...NONE,
      tipsCents: 14_250,
      month: { boats: 7, dives: 14, minutes: 27 * 60, month: 11 },
    });
    expect(container.children).toHaveLength(1);
    const block = container.firstElementChild as HTMLElement;
    expect(block.children).toHaveLength(2);
    expect(screen.getByText(/\$142\.50/)).toBeVisible();
    expect(screen.getByText(/November: 7 boats/)).toBeVisible();
  });
});
