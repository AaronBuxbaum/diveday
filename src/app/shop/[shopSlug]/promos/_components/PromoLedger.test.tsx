// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  groupPromoRows,
  PromoCodeLedger,
  type PromoCodeRow,
  TripDealLedger,
  type TripDealRow,
} from "./PromoLedger";

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
const COPY = { copyLabel: "Copy code", copiedLabel: "Copied", failedLabel: "Couldn’t copy" };

const ROWS: PromoCodeRow[] = [
  {
    id: "reef10",
    group: "live",
    code: "REEF10",
    discount: "10% off",
    description: "Standing returning-diver discount",
    facts: ["Trips and courses", "no start date", "no end date", "Redeemed 1 time"],
  },
  {
    id: "winter",
    group: "live",
    code: "WINTER15",
    discount: "15% off",
    // Switched off inside a live window: the shelf is the window, the switch
    // is this one row's exception.
    badge: { tone: "neutral", word: "Switched off" },
    facts: ["Trips only", "no start date", "no end date", "Redeemed 0 times"],
  },
  {
    id: "ow25",
    group: "ended",
    code: "OPENWATER25",
    discount: "25% off",
    facts: ["Courses only", "no start date", "until Aug 27", "Redeemed 0 times of 20"],
  },
];

function renderLedger(rows: readonly PromoCodeRow[] = ROWS) {
  return render(<PromoCodeLedger rows={rows} labels={LABELS} copy={COPY} />);
}

/** A row's line of facts: the last paragraph of its content. */
function factsLine(row: HTMLElement | undefined) {
  return [...(row?.querySelectorAll("p") ?? [])].at(-1);
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

  /**
   * **A code's line is the code's 24px line** (pixel-craft class 5; K-386).
   * The inline Copy is a ghost `sm` button, 44px tall, and as a flex item of
   * the code's line it made that line 44px: 26px from the row's rule to
   * "REEF10" against 14px from the last line to the next rule. Its wrapper is
   * the line's own 24px, so the button's box overhangs it evenly into the
   * row's `py-3` and the words set the inset.
   */
  it("keeps the copy button's 44px out of the code's line", () => {
    renderLedger();
    for (const button of screen.getAllByRole("button", { name: "Copy code" })) {
      expect(button.parentElement).toHaveClass("flex", "h-6", "items-center");
    }
  });

  /**
   * **A line of facts breaks between facts, and inside one only when it
   * must** (pixel-craft class 8; K-387). The facts arrived as one pre-joined
   * string, so at 390 a line could end on any space: "no / end date",
   * "12:00 PM / EDT". Each fact is one inline box carrying the dot after it,
   * so a line ends after a dot and never opens on one. A box rather than
   * `whitespace-nowrap`: beside a failed code's "Try again" and "Delete" the
   * column is about 188px, narrower than "until Jul 20, 12:00 PM EDT", and a
   * fact wider than the whole line then wraps inside its box instead of
   * running under the buttons.
   */
  it("sets each fact as one box and breaks the line only after a dot", () => {
    renderLedger();
    const [row] = within(screen.getByRole("list", { name: "Live" })).getAllByRole("listitem");
    const line = factsLine(row);
    const facts = [...(line?.querySelectorAll(":scope > span") ?? [])];
    expect(facts.map((fact) => fact.textContent)).toEqual([
      "Trips and courses\u00a0·",
      "no start date\u00a0·",
      "no end date\u00a0·",
      "Redeemed 1 time",
    ]);
    for (const fact of facts) {
      expect(fact).toHaveClass("inline-block");
      expect(fact).not.toHaveClass("whitespace-nowrap");
    }
    expect(line?.textContent).toBe(
      "Trips and courses\u00a0· no start date\u00a0· no end date\u00a0· Redeemed 1 time",
    );
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

describe("the trip deals ledger", () => {
  const DEAL: TripDealRow = {
    id: "deal-1",
    code: "LASTCALL20",
    discount: "20% off",
    tripTitle: "Two-Tank Reef — Molasses & French",
    href: "/shop/blue-mantis/trips/trip-1#last-minute-deal",
    facts: ["Expires Fri, Aug 28, 6:00 PM", "Sent to 9 divers"],
  };

  it("sets a deal's facts as boxes, as a code's are", () => {
    render(<TripDealLedger labelledBy="trip-deals" rows={[DEAL]} />);
    const line = factsLine(screen.getByRole("listitem"));
    const facts = [...(line?.querySelectorAll(":scope > span") ?? [])];
    expect(facts.map((fact) => fact.textContent)).toEqual([
      "Expires Fri, Aug 28, 6:00 PM\u00a0·",
      "Sent to 9 divers",
    ]);
    for (const fact of facts) expect(fact).toHaveClass("inline-block");
    expect(line?.textContent).toBe("Expires Fri, Aug 28, 6:00 PM\u00a0· Sent to 9 divers");
  });
});
