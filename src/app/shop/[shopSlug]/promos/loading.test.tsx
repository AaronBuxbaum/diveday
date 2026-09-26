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
    expect(pulse.querySelector(".grid")).toBeNull();
    // One md button's 48px, straight after the header.
    const door = pulse.querySelector(":scope > .mb-8")?.nextElementSibling;
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
   * The loaded header wraps: "Discounts a / diver can type" is two lines at
   * 390, and the description ("A code works across your whole schedule,
   * unlike the one-trip deal you send from / a departure.") is two at 390 and
   * at 1280. One bar of each dropped the page 68px at 390 and 24px at 1280.
   */
  it("draws the header's title and description at the lines they wrap to", () => {
    const header = skeleton().querySelector(":scope > .mb-8");
    const bars = (height: string) =>
      [...(header?.querySelectorAll(`.${height}`) ?? [])].map((bar) =>
        bar.classList.contains("sm:hidden") ? "phone" : "both",
      );
    expect(bars("h-11")).toEqual(["both", "phone"]);
    expect(bars("h-6")).toEqual(["both", "both"]);
  });

  it("stands each shelf's label in the 16px line a group label is", () => {
    const pulse = skeleton();
    const labels = [...pulse.querySelectorAll(".mb-2")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toHaveClass("h-4");
  });
});
