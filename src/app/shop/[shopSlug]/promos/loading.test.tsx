// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PromosLoading from "./loading";

afterEach(cleanup);

/**
 * **The promos skeleton is the page it stands in for** (docs/design/
 * pixel-craft.md, class 11; K-392).
 *
 * It still drew the new-code form as a card of four 44px fields, about 200px,
 * from before the form moved behind its "New code" disclosure: a connected
 * shop's page shows one 48px button there. And its rows were `min-h-12` with
 * a 16px and a 12px bar, where a loaded code row is its 24px code line, a
 * description and a line of facts inside the row's 12px inset.
 */
function skeleton() {
  const { container } = render(<PromosLoading />);
  const pulse = container.querySelector(".animate-pulse");
  if (!pulse) throw new Error("no skeleton");
  return pulse;
}

describe("the promos skeleton", () => {
  it("draws the New code door, not the form behind it", () => {
    const pulse = skeleton();
    // No card and no field grid: the fields wait behind the disclosure.
    expect(pulse.querySelector(".rounded-panel")).toBeNull();
    // (Money's tabs are a grid of equal columns; that is not a form.)
    const grids = [...pulse.querySelectorAll(".grid")].filter(
      (grid) => !grid.closest("[data-section-tabs]"),
    );
    expect(grids).toEqual([]);
    // One md button's 48px, straight after the header and Money's tabs.
    const door = pulse.querySelector(":scope > .mb-8")?.nextElementSibling?.nextElementSibling;
    expect(door).toHaveClass("mt-8", "h-12");
  });

  it("draws each row as a loaded code row: a 24px code line and two 20px lines", () => {
    const rows = [...skeleton().querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // `LedgerRow pad="lg"`, the codes ledger's inset.
      expect(row).toHaveClass("py-3", "min-h-13");
      const lines = [...(row.querySelector(":scope > .flex-1")?.children ?? [])];
      expect(
        lines.map((line) => [...line.classList].find((token) => /^h-\d+$/.test(token))),
      ).toEqual(["h-6", "h-5", "h-5"]);
    }
  });

  /**
   * The loaded header is "Money", one line at every width, and nothing under
   * it: the description went with the copy cut of 2026-10-03, so a bar for it
   * would drop the page when it loads.
   */
  it("draws the header's title at one line and no description", () => {
    const header = skeleton().querySelector(":scope > .mb-8");
    const bars = (height: string) =>
      [...(header?.querySelectorAll(`.${height}`) ?? [])].map((bar) =>
        bar.classList.contains("sm:hidden") ? "phone" : "both",
      );
    expect(bars("h-11")).toEqual(["both"]);
    expect(bars("h-6")).toEqual([]);
  });

  it("stands each shelf's label in the 16px line a group label is", () => {
    const pulse = skeleton();
    const labels = [...pulse.querySelectorAll(".mb-2")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toHaveClass("h-4");
  });
});
