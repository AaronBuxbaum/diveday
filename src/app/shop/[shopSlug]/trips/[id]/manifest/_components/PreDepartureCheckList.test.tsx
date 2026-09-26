// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PreDepartureCheckList, type PreDepartureCheckListCopy } from "./PreDepartureCheckList";

afterEach(cleanup);

const copy: PreDepartureCheckListCopy = {
  heading: "Before you leave the dock",
  summary: "Before you leave the dock — 1 of 2 checked",
  errorRefusal: "That check did not save.",
  checkedLabel: "Checked",
  uncheckedLabel: "Not checked",
};

const items = [
  {
    id: "oxygen",
    label: "Emergency oxygen kit aboard",
    checkedByLine: "Checked by the recorder · 7:12 AM",
    printLine: "Emergency oxygen kit aboard — Checked by the recorder · 7:12 AM",
  },
  {
    id: "radio",
    label: "Radio check done",
    printLine: "Radio check done — Not checked",
  },
];

/**
 * **The sheet a captain carries prints each mark in front of its own line.**
 *
 * The printed list is restated outside the disclosure so paper still says
 * what was checked. Its mark was a bare `StatusMark`, which preflight makes a
 * block, so on paper every box stood on a line of its own above the words it
 * belonged to (K-15) — a list of boxes and a list of sentences, interleaved.
 * Only the layout moved: which mark an item prints, and the line beside it,
 * are pinned here unchanged, including the one that matters most on a boat —
 * an unchecked item never prints a checked box.
 */
describe("the printed pre-departure list", () => {
  function printedRows() {
    const { container } = render(
      <PreDepartureCheckList action={async () => null} items={items} copy={copy} />,
    );
    const printed = container.querySelector(".print\\:block");
    if (!printed) throw new Error("no printed list");
    return Array.from(printed.querySelectorAll("li"));
  }

  it("opens each line with its mark, standing in the line rather than above it", () => {
    const rows = printedRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const box = row.firstElementChild;
      expect(box?.tagName).toBe("SPAN");
      expect(box).toHaveClass("inline-flex", "h-lh", "items-center", "align-top");
      expect(box?.querySelector("svg")).not.toBeNull();
    }
  });

  it("prints a checked box only for the item that was checked", () => {
    const [oxygen, radio] = printedRows();
    expect(oxygen.textContent?.trim()).toBe(items[0].printLine);
    expect(radio.textContent?.trim()).toBe(items[1].printLine);
    // `checked` draws the box and its tick; `unchecked` draws the box alone.
    expect(oxygen.querySelectorAll("svg path")).toHaveLength(1);
    expect(radio.querySelectorAll("svg path")).toHaveLength(0);
    expect(radio.querySelector("svg rect")).not.toBeNull();
  });
});
