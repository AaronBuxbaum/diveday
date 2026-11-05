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
  heldTitle: "Drills held",
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
    month: "2026-11",
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
  it("says how long since each drill, lists the month's, and offers the form", () => {
    const html = renderToStaticMarkup(<DrillLog view={view} />);
    expect(html).toContain("Emergency oxygen: last drill 94 days ago");
    expect(html).toContain("Fire: no drill on record");
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
