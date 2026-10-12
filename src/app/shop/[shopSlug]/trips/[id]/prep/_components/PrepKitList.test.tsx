// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FIGURE_CLASS } from "@/components/ui/typography";
import type { TripPrep } from "@/db/trips";
import { diveRecencyText } from "@/i18n/readiness-labels";
import type { PrepGrouping } from "@/lib/dive-prep";
import { PrepKitList } from "./PrepKitList";
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

  it("starts both values of a kit card at one x, however long the names run (K-147)", () => {
    const { container } = renderKitList(everyPanelPrep());
    const cards = container.querySelectorAll("ul.sm\\:hidden > li dl");
    expect(cards.length).toBeGreaterThan(0);
    for (const dl of cards) {
      expect(tokens(dl)).toEqual(
        expect.arrayContaining(["grid", "grid-cols-[auto_minmax(0,1fr)]", "gap-x-2"]),
      );
      expect(dl.children).toHaveLength(2);
      for (const pair of dl.children) {
        expect(tokens(pair)).toEqual(
          expect.arrayContaining(["col-span-2", "grid", "grid-cols-subgrid"]),
        );
      }
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

  it("sets each card's count on its title's baseline (K-149)", () => {
    for (const grouping of ["item", "diver"] as const) {
      const { container, unmount } = renderKitList(everyPanelPrep(), { grouping });
      const counts = [...container.querySelectorAll("ul.sm\\:hidden > li p")].filter((p) =>
        tokens(p).includes(FIGURE_CLASS.split(" ")[0]),
      );
      expect(counts.length, grouping).toBeGreaterThan(0);
      for (const count of counts) {
        expect(tokens(count.parentElement), grouping).toContain("items-baseline");
        expect(tokens(count.parentElement), grouping).not.toContain("items-start");
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
    // Carmen and Grace share the BCD L line: drawn as a phone card's For list
    // and as the table's For cell.
    const shared = [...container.querySelectorAll("dd, td")].filter(
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
