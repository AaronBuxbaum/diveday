// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { groupPromoRows, PromoCodeLedger, type PromoCodeRow } from "./PromoLedger";

afterEach(cleanup);

/**
 * Slice 9g of ADR 20260827-the-shops-shelves: the codes list is one ledger
 * shelved live / scheduled / ended, on one Pager.
 *
 * Two rules, both of which regress into something that looks tidier:
 *
 * - **A shelf is a run, never a bucket.** The query sorts group-major so a
 *   shelf cannot interleave across a page boundary; a component that bucketed
 *   into a map would hide a broken sort and reorder each shelf's rows on the
 *   way through.
 * - **The window is said once, by the header; the badge marks the
 *   exception.** A "Live" pill on every live code is a badge on the expected
 *   state (20260827-clearwater-surface-language, decision 3) and it is exactly
 *   what a future edit puts back.
 */

const LABELS = { live: "Live", scheduled: "Scheduled", ended: "Ended" } as const;
const COPY = { copyLabel: "Copy code", copiedLabel: "Copied", failedLabel: "Couldn't copy" };

const ROWS: PromoCodeRow[] = [
  {
    id: "reef10",
    group: "live",
    code: "REEF10",
    discount: "10% off",
    description: "Standing returning-diver discount",
    facts: "Trips and courses · no start date · no end date · Redeemed 1 time",
  },
  {
    id: "winter",
    group: "live",
    code: "WINTER15",
    discount: "15% off",
    // Switched off inside a live window: the shelf is the window, the switch
    // is this one row's exception.
    badge: { tone: "neutral", word: "Switched off" },
    facts: "Trips only · no start date · no end date · Redeemed 0 times",
  },
  {
    id: "ow25",
    group: "ended",
    code: "OPENWATER25",
    discount: "25% off",
    facts: "Courses only · no start date · until Aug 27 · Redeemed 0 times of 20",
  },
];

function renderLedger(rows: readonly PromoCodeRow[] = ROWS) {
  return render(<PromoCodeLedger rows={rows} labels={LABELS} copy={COPY} />);
}

describe("shelving the codes", () => {
  it("gathers a run into one shelf and keeps the order it was handed", () => {
    const groups = groupPromoRows(ROWS);
    expect(groups.map((group) => group.group)).toEqual(["live", "ended"]);
    expect(groups[0]?.rows.map((row) => row.code)).toEqual(["REEF10", "WINTER15"]);
  });

  it("draws a break rather than merging a shelf that resumes", () => {
    // The query sorts group-major so this cannot happen; if it stopped, the
    // ledger must show it rather than silently re-ordering the codes.
    const shuffled = [ROWS[0], ROWS[2], ROWS[1]].filter(
      (row): row is PromoCodeRow => row !== undefined,
    );
    expect(groupPromoRows(shuffled).map((group) => group.group)).toEqual(["live", "ended", "live"]);
  });

  it("has no shelves at all for a shop with no codes", () => {
    expect(groupPromoRows([])).toEqual([]);
  });
});

describe("the codes ledger", () => {
  it("names each shelf once, above its own rows", () => {
    renderLedger();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Live",
      "Ended",
    ]);
    expect(
      within(screen.getByRole("list", { name: "Live" })).getAllByRole("listitem"),
    ).toHaveLength(2);
  });

  it("never repeats the shelf's word down its own rows", () => {
    renderLedger();
    // One "Live" on the page: the heading. A pill saying it again on every row
    // is a badge marking the expected state.
    expect(screen.getAllByText("Live")).toHaveLength(1);
    expect(screen.getAllByText("Ended")).toHaveLength(1);
  });

  it("badges only the code with something exceptional to say", () => {
    renderLedger();
    expect(screen.getAllByText("Switched off")).toHaveLength(1);
    const live = within(screen.getByRole("list", { name: "Live" })).getAllByRole("listitem");
    expect(live[0]?.textContent).toContain("REEF10");
    expect(live[0]?.textContent).not.toContain("Switched off");
  });

  it("carries no count on a shelf — one Pager counts the whole run", () => {
    renderLedger();
    // A per-shelf tally would count *this page's* rows and read as the
    // shelf's size, changing when the reader turns the page with nothing
    // saying why. `GroupLabel` renders a `meta` as a span immediately after
    // the heading, so the rows following it directly is the absence.
    for (const heading of screen.getAllByRole("heading", { level: 2 })) {
      expect(heading.nextElementSibling?.tagName).toBe("UL");
    }
  });
});
