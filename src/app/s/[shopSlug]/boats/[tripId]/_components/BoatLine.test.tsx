// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoatLine } from "./BoatLine";

afterEach(cleanup);

/**
 * **Every stop's mark sits in one 16px box** (pixel-craft class 3, K-379).
 * The ring on `now` is 16px and the plain dots 8px, all packed left in the
 * row's leading slot, so "Check-in" started 8px right of "Leaves" and "Back"
 * and the dots did not share a centre line. One box, the ring's size, for
 * every mark: the dots centre on one line and every label starts at one x.
 */
describe("BoatLine's marks", () => {
  it("draws every mark, done, now or ahead, in the same 16px box", () => {
    render(
      <BoatLine
        heading="The day"
        steps={[
          { key: "check-in", time: "7:30 AM", label: "Check-in", mark: "done" },
          { key: "leaves", time: "8:00 AM", label: "Leaves", mark: "now" },
          { key: "back", time: "1:00 PM", label: "Back", mark: "todo" },
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // The row's leading slot, then the mark's own box inside it.
      const box = row.firstElementChild?.firstElementChild;
      expect(box?.className, row.textContent ?? "").toMatch(/\bsize-4\b/);
      expect(box?.className).toMatch(/\bitems-center\b/);
      expect(box?.className).toMatch(/\bjustify-center\b/);
    }
  });
});
