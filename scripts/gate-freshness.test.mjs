import { describe, expect, it } from "vitest";

import {
  classifyStatus,
  daysSince,
  gateIdsIn,
  latestDateIn,
  movementFor,
  parseGateRows,
  parseThirtyDayList,
  reconcileThirtyDays,
} from "./gate-freshness.mjs";

// Fixtures deliberately mimic the register's real shape — long prose cells with several
// dates in them, a strikethrough Dropped row, a multi-word status — rather than a tidy
// table, because that prose is exactly what the parser has to survive.
const REGISTER_FIXTURE = `# Human decision log

## Decision register

| ID | Status | Human owner | Decision |
| --- | --- | --- | --- |
| H-01 | Ready | Product owner | **Jurisdiction confirmed 2026-07-30**, superseding the 2026-07-24 assumption. |
| H-02 | Implemented | Product owner | Recorded 2026-07-24. See [ADR](../architecture/decisions/20260718-vercel-hosting.md). |
| H-03 | Dropped | Product owner | ~~No longer needed.~~ |
| H-04 | Deferred | Product owner + broker | Decided 2026-07-28: revisit later. |
| H-05 | In progress | Product owner | No date recorded here at all. |

## Human verification queue

| ID | Status | Human owner | Work | Evidence |
| --- | --- | --- | --- | --- |
| V-01 | Ready | QA owner | Browser-check the merged experience. | Screenshots. |
| V-02 | Ready before production | Ops lead | Field-test the manifest on a boat. | Sign-off. |
`;

const ROLLOUT_FIXTURE = `# Rollout plan

Written 2026-07-24 against the shipped state.

## The next 30 days, in order

1. Book the attorney (H-01–H-03) and take the corporate footing (H-04) into the same
   week.
2. Name the ops owner (H-05).
3. Run V-01 and script the V-02 boat day.
4. Decide DEMA posture and join DEMA.

## Review cadence

Revisit at each phase boundary.
`;

const NOW = new Date("2026-08-02T12:00:00Z");

describe("classifyStatus", () => {
  it("collapses the register's status key into open / parked / closed", () => {
    expect(classifyStatus("Ready")).toBe("open");
    expect(classifyStatus("Ready before production")).toBe("open");
    expect(classifyStatus("In progress")).toBe("open");
    expect(classifyStatus("Chosen")).toBe("open");
    expect(classifyStatus("Deferred")).toBe("parked");
    expect(classifyStatus("Implemented")).toBe("closed");
    expect(classifyStatus("Validated")).toBe("closed");
    expect(classifyStatus("Dropped")).toBe("closed");
  });

  it("treats an unrecognised status as open — an unknown word is not evidence of done", () => {
    expect(classifyStatus("Awaiting counsel")).toBe("open");
  });
});

describe("latestDateIn", () => {
  it("takes the newest date in a cell, not the first", () => {
    expect(latestDateIn("Recorded 2026-07-24, revised 2026-07-30, noted 2026-07-26")).toBe(
      "2026-07-30",
    );
  });

  it("ignores ADR filename stamps, which carry no hyphens", () => {
    expect(latestDateIn("See 20260801-cache-components.md")).toBeNull();
  });

  it("returns null when a row has never been dated", () => {
    expect(latestDateIn("No date recorded here at all.")).toBeNull();
  });
});

describe("parseGateRows", () => {
  const rows = parseGateRows(REGISTER_FIXTURE);

  it("reads both tables and skips the header/separator rows", () => {
    expect(rows.map((row) => row.id)).toEqual([
      "H-01",
      "H-02",
      "H-03",
      "H-04",
      "H-05",
      "V-01",
      "V-02",
    ]);
  });

  it("carries status, lifecycle state, and the newest dated outcome per row", () => {
    const h1 = rows.find((row) => row.id === "H-01");
    expect(h1).toMatchObject({ status: "Ready", state: "open", datedOutcome: "2026-07-30" });
    expect(rows.find((row) => row.id === "H-03")).toMatchObject({ state: "closed" });
    expect(rows.find((row) => row.id === "H-04")).toMatchObject({ state: "parked" });
    expect(rows.find((row) => row.id === "V-02")).toMatchObject({
      status: "Ready before production",
      state: "open",
    });
  });

  it("records a 1-based line number so git blame can be joined onto the row", () => {
    const lines = REGISTER_FIXTURE.split("\n");
    for (const row of rows) expect(lines[row.line - 1]).toContain(`| ${row.id} |`);
  });

  it("leaves an undated row's datedOutcome null rather than guessing", () => {
    expect(rows.find((row) => row.id === "H-05")?.datedOutcome).toBeNull();
  });
});

describe("gateIdsIn", () => {
  it("expands an en-dashed range so the middle row is not lost", () => {
    expect(gateIdsIn("Book the attorney (H-01–H-03)")).toEqual(["H-01", "H-02", "H-03"]);
  });

  it("handles hyphen and em-dash ranges and a repeated prefix", () => {
    expect(gateIdsIn("V-01-V-03")).toEqual(["V-01", "V-02", "V-03"]);
    expect(gateIdsIn("H-07—H-08")).toEqual(["H-07", "H-08"]);
  });

  it("collects standalone ids and dedupes", () => {
    expect(gateIdsIn("Close H-12; H-13 needs a ruling; H-12 again")).toEqual(["H-12", "H-13"]);
  });

  it("returns nothing for an item that names no gate row", () => {
    expect(gateIdsIn("Decide DEMA posture and join DEMA.")).toEqual([]);
  });
});

describe("parseThirtyDayList", () => {
  const list = parseThirtyDayList(ROLLOUT_FIXTURE);

  it("reads the plan's stated authorship date — the 30-day clock's start", () => {
    expect(list.writtenOn).toBe("2026-07-24");
  });

  it("stops at the next heading and folds continuation lines into their item", () => {
    expect(list.items).toHaveLength(4);
    expect(list.items[0].text).toContain("into the same week.");
    expect(list.items.at(-1).text).toContain("DEMA");
  });
});

describe("daysSince", () => {
  it("floors to whole days and never goes negative", () => {
    expect(daysSince("2026-07-24", NOW)).toBe(9);
    expect(daysSince("2026-08-02", NOW)).toBe(0);
    expect(daysSince("2026-09-01", NOW)).toBe(0);
  });

  it("returns null for an unparseable date", () => {
    expect(daysSince("not-a-date", NOW)).toBeNull();
  });
});

describe("movementFor", () => {
  const dated = { datedOutcome: "2026-07-24" };
  const undated = { datedOutcome: null };

  it("prefers a dated outcome and reports it exactly", () => {
    expect(
      movementFor(dated, { at: new Date("2026-07-30T00:00:00Z"), bounded: true }, NOW),
    ).toEqual({
      on: "2026-07-24",
      days: 9,
      atLeast: false,
      evidence: "dated outcome in the row",
    });
  });

  it("falls back to git blame for an undated row", () => {
    expect(
      movementFor(undated, { at: new Date("2026-07-28T09:00:00Z"), bounded: false }, NOW),
    ).toMatchObject({ on: "2026-07-28", days: 5, atLeast: false });
  });

  it("marks a grafted blame attribution as a lower bound, not a number", () => {
    const result = movementFor(
      undated,
      { at: new Date("2026-07-30T00:00:00Z"), bounded: true },
      NOW,
    );
    expect(result).toMatchObject({ on: "2026-07-30", days: 3, atLeast: true });
    expect(result.evidence).toContain("history truncated");
  });

  it("says so plainly when there is no evidence at all", () => {
    expect(movementFor(undated, null, NOW)).toMatchObject({ on: null, days: null });
  });
});

describe("reconcileThirtyDays", () => {
  const rows = parseGateRows(REGISTER_FIXTURE).map((row) => ({
    ...row,
    movement: movementFor(row, null, NOW),
  }));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const reconciled = reconcileThirtyDays(parseThirtyDayList(ROLLOUT_FIXTURE).items, rowsById);

  it("flags a listed item whose named rows have all stayed open", () => {
    const item = reconciled.find((entry) => entry.number === 2);
    expect(item).toMatchObject({ ids: ["H-05"], unstarted: true, unmeasurable: false });
  });

  it("does not flag an item that closed at least one of its rows", () => {
    const item = reconciled.find((entry) => entry.number === 1);
    expect(item.ids).toEqual(["H-01", "H-02", "H-03", "H-04"]);
    expect(item.closedCount).toBe(2);
    expect(item.unstarted).toBe(false);
  });

  it("reports the newest dated movement across an item's rows", () => {
    expect(reconciled.find((entry) => entry.number === 1)?.newestMovement).toBe("2026-07-30");
  });

  it("marks an item that names no gate row as unmeasurable rather than passing it", () => {
    const item = reconciled.find((entry) => entry.number === 4);
    expect(item).toMatchObject({ unmeasurable: true, unstarted: false, ids: [] });
  });

  it("names ids the register does not contain instead of dropping them", () => {
    const [item] = reconcileThirtyDays([{ number: 1, text: "Chase H-99." }], rowsById);
    expect(item.unknownIds).toEqual(["H-99"]);
    expect(item.unmeasurable).toBe(true);
  });
});
