// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import { diveRecencyText } from "@/i18n/readiness-labels";
import type { PrepGrouping } from "@/lib/dive-prep";
import { PrepKitList } from "./PrepKitList";
import { KIT_PHONE_ROW_CLASS } from "./prep-lines";
import {
  diverLinks,
  everyPanelPrep,
  PREP_GROUP_PATH,
  prepFor,
  t,
  tokens,
  viewOf,
  withSeats,
} from "./prep-test-fixtures";

afterEach(cleanup);

function renderKitList(prep: TripPrep, { grouping = "item" }: { grouping?: PrepGrouping } = {}) {
  return render(
    <PrepKitList view={viewOf(prep)} grouping={grouping} groupPath={PREP_GROUP_PATH} />,
  );
}

describe("PrepKitList", () => {
  it("points its grouping switch at the page it is rendering on", () => {
    // The switch is a state toggle, not a navigation: on the departure page it
    // must not jump the reader to `/prep`, which is the same list on a page
    // that is only the list.
    renderKitList(prepFor());
    const byDiver = screen.getByRole("link", { name: "By diver" });
    expect(byDiver.getAttribute("href")).toBe("/shop/blue-mantis/trips/t1?group=diver");
  });
});

/**
 * Issue #2213. The crew loads one snorkel vest per snorkeler seat, said in the
 * rental kit section; a snorkel-only boat is not an empty one.
 */
describe("snorkel vests", () => {
  it("says how many vests to load on a mixed boat, one per snorkeler", () => {
    const { container } = renderKitList(withSeats(["diver", "snorkeler", "snorkeler", "rider"]));
    expect(within(container).getByText("2 snorkel vests, one per snorkeler")).toBeTruthy();
  });

  it("says nothing of vests on a boat with no snorkelers", () => {
    const { container } = renderKitList(withSeats(["diver", "rider"]));
    expect(within(container).queryByText(/snorkel vest/)).toBeNull();
  });
});

/**
 * **How the packing list is drawn** (docs/design/pixel-craft.md). jsdom has no
 * layout, so each case pins the classes whose arithmetic the pixel probe
 * measured wrong; the probe re-measures the pixels.
 */
/**
 * **The tab says what is short on the piece, not in a sentence about the list**
 * (UX review 2026-10-10, item 26). Grace rents weights and gave no weight:
 * her weights line carries "Size missing" in the warning ink, by item and by
 * diver.
 */
describe("a piece with no size on the Gear tab", () => {
  it("marks the piece itself, in both groupings", () => {
    for (const grouping of ["item", "diver"] as const) {
      const { container, unmount } = renderKitList(everyPanelPrep(), { grouping });
      const marks = [...container.querySelectorAll("[data-size-missing]")];
      // The phone row and the table, each once for Grace's weights.
      expect(marks.length, grouping).toBe(2);
      for (const mark of marks) {
        expect(mark).toHaveTextContent(t("tripPrep.sizeMissing"));
        expect(tokens(mark), grouping).toContain("text-warning-strong");
      }
      unmount();
    }
  });
});

describe("the packing list's geometry", () => {
  it("gives the phone card's name a 44px target on its 24px line, and the table's row the RowLink (K-146)", () => {
    const { container } = renderKitList(everyPanelPrep(), { grouping: "diver" });
    const carmen = diverLinks(container).filter((link) => link.textContent === "Carmen Ruiz");
    expect(carmen).toHaveLength(2);
    const [card, row] = carmen;
    expect(tokens(card)).toEqual(expect.arrayContaining(["inline-flex", "min-h-11", "-my-2.5"]));
    // The table's first cell is the row's one way in: `RowLink`'s overlay,
    // positioned against `Tr`'s `relative`, never against the page.
    expect(tokens(row)).toEqual(expect.arrayContaining(["min-h-11", "after:absolute", "-my-3"]));
    expect(row.closest("tr")).toHaveClass("relative");
  });

  it("keeps the piece, recipient and count together in each phone packing item", () => {
    // Twenty-three cards of a Size row and a For row ran a seeded boat's Gear
    // tab to 7,000px at 390. One card of rows now, three cells each, and the
    // recipient may wrap beneath the piece while quantity stays adjacent.
    // Rendered geometry is verified by the phone capture.
    const { container } = renderKitList(everyPanelPrep());
    const card = container.querySelector("ul.sm\\:hidden");
    expect(card).not.toBeNull();
    expect(tokens(card)).toEqual(expect.arrayContaining(["divide-y", "print:hidden"]));
    const rows = card?.querySelectorAll(":scope > li") ?? [];
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.className).toBe(KIT_PHONE_ROW_CLASS);
      expect(row.children).toHaveLength(3);
    }
  });

  it("pins the quantity column narrow in both tables, so the names get the room (K-148)", () => {
    for (const grouping of ["item", "diver"] as const) {
      const { container, unmount } = renderKitList(everyPanelPrep(), { grouping });
      const qty = within(container)
        .getAllByRole("columnheader")
        .filter((th) => th.textContent === t("tripPrep.qtyColumn"));
      expect(qty, grouping).toHaveLength(1);
      expect(qty[0], grouping).toHaveClass("w-32");
      unmount();
    }
    // The by-item table's short Item column is pinned too, so Size and For
    // share what is left: with three unnamed columns splitting it, For held
    // two names a line at 1280 and the fifth fell alone onto a third.
    const { container } = renderKitList(everyPanelPrep());
    const item = within(container).getByRole("columnheader", { name: t("tripPrep.itemColumn") });
    expect(item).toHaveClass("w-40");
    for (const unpinned of [t("tripPrep.sizeColumn"), t("tripPrep.forColumn")]) {
      const header = within(container).getByRole("columnheader", { name: unpinned });
      expect(
        tokens(header).filter((token) => /^w-/.test(token)),
        unpinned,
      ).toEqual([]);
    }
  });

  it("hangs a kit piece's wrapped detail under the detail, not under the piece (K-148)", () => {
    const { container } = renderKitList(everyPanelPrep(), { grouping: "diver" });
    const row = diverLinks(container)
      .filter((link) => link.textContent === "Carmen Ruiz")[1]
      .closest("tr") as HTMLElement;
    const pieces = row.querySelectorAll("td:nth-child(2) li");
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece).toHaveClass("flex");
      // The piece and its detail are two boxes; no bare text between them.
      for (const node of piece.childNodes) expect(node.nodeType).toBe(Node.ELEMENT_NODE);
    }
  });

  it("sets each phone row's count on its first line's baseline (K-149)", () => {
    for (const grouping of ["item", "diver"] as const) {
      const { container, unmount } = renderKitList(everyPanelPrep(), { grouping });
      const rows = [...container.querySelectorAll("ul.sm\\:hidden > li")];
      expect(rows.length, grouping).toBeGreaterThan(0);
      for (const row of rows) {
        expect(tokens(row), grouping).toContain("items-baseline");
        expect(tokens(row), grouping).not.toContain("items-start");
        const count = row.lastElementChild as HTMLElement;
        expect(tokens(count), grouping).toContain("tabular-nums");
      }
      unmount();
    }
  });

  it("sets the dive-recency mark on the note's first line, not its middle (K-281)", () => {
    const { container } = renderKitList(everyPanelPrep(), { grouping: "diver" });
    const words = diveRecencyText(t, "over_five_years") ?? "";
    const notes = [...container.querySelectorAll("span")].filter(
      (span) => span.textContent === words && span.children.length > 0,
    );
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(tokens(note)).toEqual(expect.arrayContaining(["flex", "items-start", "gap-2"]));
      expect(tokens(note)).not.toContain("items-center");
    }
  });

  it("breaks a shared rental line between two names, and a name only where it cannot fit whole (K-353)", () => {
    const { container } = renderKitList(everyPanelPrep());
    // Carmen and Grace share the BCD L line: drawn as a phone row's middle
    // and as the table's For cell.
    const shared = [...container.querySelectorAll("[data-kit-line] > p, td")].filter(
      (cell) => cell.textContent === "Carmen Ruiz, Grace Mensah",
    );
    expect(shared).toHaveLength(2);
    for (const cell of shared) {
      const names = [...cell.children];
      expect(names.map((name) => name.textContent)).toEqual(["Carmen Ruiz,", "Grace Mensah"]);
      for (const name of names) {
        // Its own box: it moves to the next line whole, and wraps inside
        // itself only when it is wider than the column. Unbreakable, a name
        // wider than a clipping cell was cut off without a mark.
        expect(name.tagName).toBe("SPAN");
        expect(tokens(name)).toContain("inline-block");
        expect(tokens(name)).not.toContain("whitespace-nowrap");
      }
      // The comma travels with the name before it; the only break between two
      // names is the bare space.
      const between = [...cell.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
      expect(between.map((node) => node.textContent)).toEqual([" "]);
    }
  });

  it("floors the by-item table at a width a 768px tablet holds without scrolling (K-506)", () => {
    const { container } = renderKitList(everyPanelPrep());
    const byItem = [...container.querySelectorAll("table")].find((table) =>
      within(table).queryByRole("columnheader", { name: t("tripPrep.itemColumn") }),
    );
    expect(byItem).toHaveClass("min-w-[40rem]");
    expect(byItem).not.toHaveClass("min-w-[45rem]");
  });
});
