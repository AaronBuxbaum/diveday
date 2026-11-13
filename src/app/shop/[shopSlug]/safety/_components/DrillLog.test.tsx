import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DrillLog } from "./DrillLog";
import type { DrillLogView } from "./drill-log-read";

vi.mock("../actions", () => ({
  recordSafetyDrillAction: vi.fn(),
  deleteSafetyDrillAction: vi.fn(),
}));

const view: DrillLogView = {
  title: "Drills",
  since: [
    { kind: "oxygen", never: false, text: "Emergency oxygen: last drill 94 days ago" },
    { kind: "fire", never: true, text: "Fire: no drill on record" },
  ] as DrillLogView["since"],
  tiles: [
    {
      kind: "oxygen",
      label: "Emergency oxygen",
      days: 94,
      caption: "days since the last drill",
    },
    { kind: "fire", label: "Fire", days: null, caption: "No drill on record" },
  ] as DrillLogView["tiles"],
  heldTitle: "Drills held",
  heldSummary: "1 in the last year",
  held: [
    {
      id: "d1",
      line: "Nov 2 · Emergency oxygen",
      people: "Keiko and Omar",
      note: "Both kits",
      logged: "Logged by Keiko, Nov 3",
    },
  ],
  form: {
    earliest: "2025-11-04",
    today: "2026-11-04",
    noteMax: 500,
    kinds: [{ value: "oxygen", label: "Emergency oxygen" }],
    staff: [{ id: "p1", name: "Keiko Tanaka" }],
    copy: {
      logTitle: "Log a drill",
      kindLabel: "Drill",
      dateLabel: "Held on",
      peopleLabel: "Who took part",
      noteLabel: "Note",
      optional: "(optional)",
      submit: "Log drill",
      delete: "Delete",
      deleteConfirm: "Delete drill",
      deleting: "Deleting…",
      saving: "Saving…",
    },
  },
};

describe("DrillLog", () => {
  it("draws a tile per drill with its days, keeps the held drills closed, and offers the form", () => {
    const html = renderToStaticMarkup(<DrillLog view={view} />);
    expect(html).toContain("Emergency oxygen");
    expect(html).toContain(">94<");
    expect(html).toContain("days since the last drill");
    expect(html).toContain("No drill on record");
    // The held drills sit in a disclosure that starts shut.
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*id="drills-held"/);
    expect(html).toContain("Keiko and Omar");
    expect(html).toContain("Log a drill");
    expect(html).toContain("Delete");
  });

  it("prints the lines and the drills, with who logged each, and no form and no control", () => {
    const html = renderToStaticMarkup(<DrillLog view={view} paper />);
    expect(html).toContain("Emergency oxygen: last drill 94 days ago");
    expect(html).toContain("Nov 2 · Emergency oxygen");
    expect(html).toContain("Logged by Keiko, Nov 3");
    expect(html).not.toContain("Log a drill");
    expect(html).not.toContain("<form");
  });
});
