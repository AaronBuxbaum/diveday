import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReport,
  familyForRoute,
  grepFor,
  renderMarkdown,
  rerunCommand,
  routeForPath,
  tileGrid,
} from "./pixel-probe-report.mjs";

/**
 * The report is where the probe's output meets a person, so the parts that
 * can silently mislead are pinned here: the re-run command must select exactly
 * one test (capture names never appear in titles, and Playwright takes one
 * `--grep`), "skipped" must never read as "clean", and a settled flag must be
 * listed rather than dropped.
 */

const TITLE = [
  "visual.spec.ts",
  "light mode",
  "public",
  "the shopfront's register form renders true to the design (light)",
];

describe("the re-run command", () => {
  it("escapes the title into a regex that matches it exactly", () => {
    const pattern = grepFor(TITLE);
    expect(pattern).toBe(
      "light mode public the shopfront's register form renders true to the design \\(light\\)",
    );
    expect(new RegExp(pattern).test(TITLE.slice(1).join(" "))).toBe(true);
  });

  it("quotes an apostrophe so the shell sees one argument", () => {
    const command = rerunCommand({ titlePath: TITLE, testFile: "" });
    expect(command).toContain("--grep 'light mode public the shopfront'\\''s register");
    expect(command).toMatch(
      /^PIXEL_PROBE=1 pnpm e2e:run e2e\/visual\.spec\.ts --grep '.*' --reporter=line$/,
    );
  });

  it("points a dev-server probe at screenshot.mjs instead", () => {
    expect(rerunCommand({ source: "dev", path: "/shop/blue-mantis/settings/security" })).toBe(
      "node scripts/screenshot.mjs /shop/blue-mantis/settings/security --probe",
    );
  });

  it.each(["e2e/visual.spec.ts", path.resolve("e2e/visual.spec.ts")])(
    "reruns an imported capture through its explicit entry file %s",
    (entryFile) => {
      const command = rerunCommand({
        titlePath: TITLE,
        testFile: path.resolve("e2e/visual-audit-account-states.ts"),
        entryFile,
      });
      expect(command).toContain("pnpm e2e:run e2e/visual.spec.ts --grep");
      expect(command).not.toContain("visual-audit-account-states.ts");
    },
  );

  it("recovers an older imported visual record only when its title confirms the entry file", () => {
    const record = {
      titlePath: TITLE,
      testFile: path.resolve("e2e/visual-audit-account-states.ts"),
    };
    expect(rerunCommand(record)).toContain("pnpm e2e:run e2e/visual.spec.ts --grep");
    expect(rerunCommand({ ...record, titlePath: ["other.spec.ts", "an imported test"] })).toContain(
      "pnpm e2e:run e2e/visual-audit-account-states.ts --grep",
    );
  });

  it("keeps a legacy direct-spec rerun on its original file without audit flags", () => {
    const command = rerunCommand({
      titlePath: ["pixel-probe.spec.ts", "the probe fixture"],
      testFile: path.resolve("e2e/pixel-probe.spec.ts"),
    });
    expect(command).toBe(
      "PIXEL_PROBE=1 pnpm e2e:run e2e/pixel-probe.spec.ts --grep 'the probe fixture' --reporter=line",
    );
  });

  it("retains the opt-in modes needed to reproduce an audit capture", () => {
    const base = { titlePath: TITLE, entryFile: "e2e/visual.spec.ts" };
    expect(rerunCommand({ ...base, exhaustiveAudit: true })).toMatch(
      /^PIXEL_PROBE=1 VISUAL_EXHAUSTIVE_AUDIT=1 pnpm e2e:run /,
    );
    expect(rerunCommand({ ...base, initialPaintAudit: true })).toMatch(
      /^PIXEL_PROBE=1 VISUAL_AUDIT_INITIAL_PAINT=1 pnpm e2e:run /,
    );
    expect(rerunCommand({ ...base, exhaustiveAudit: true, initialPaintAudit: true })).toMatch(
      /^PIXEL_PROBE=1 VISUAL_EXHAUSTIVE_AUDIT=1 VISUAL_AUDIT_INITIAL_PAINT=1 pnpm e2e:run /,
    );
    expect(rerunCommand({ ...base, exhaustiveAudit: false, initialPaintAudit: false })).toMatch(
      /^PIXEL_PROBE=1 pnpm e2e:run /,
    );
  });
});

describe("routes and families", () => {
  const routes = [
    "/switching/[competitor]",
    "/switching/spreadsheet",
    "/shop/[shopSlug]",
    "/shop/[shopSlug]/trips/[id]/manifest",
  ];

  it("prefers the most literal route", () => {
    expect(routeForPath("/switching/spreadsheet", routes)).toBe("/switching/spreadsheet");
    expect(routeForPath("/switching/eve", routes)).toBe("/switching/[competitor]");
    expect(routeForPath("/shop/blue-mantis/trips/9/manifest?boat=1", routes)).toBe(
      "/shop/[shopSlug]/trips/[id]/manifest",
    );
  });

  it("files each route under its audit family", () => {
    expect(familyForRoute("/").key).toBe("public");
    expect(familyForRoute("/s/[shopSlug]/trips/[id]").key).toBe("diver");
    expect(familyForRoute("/ready/[token]").key).toBe("token");
    expect(familyForRoute("/shop/[shopSlug]").key).toBe("staff-day");
    expect(familyForRoute("/shop/[shopSlug]/trips/[id]/manifest").key).toBe("departure");
    expect(familyForRoute("/shop/[shopSlug]/gear/[id]").key).toBe("records");
    expect(familyForRoute("/shop/[shopSlug]/orders").key).toBe("money");
    expect(familyForRoute("/shop/[shopSlug]/settings/team").key).toBe("settings");
    expect(familyForRoute(null).key).toBe("chrome");
  });
});

describe("the report", () => {
  const flag = {
    check: "focus-ring-clipped",
    severity: "S2",
    sig: "summary.row",
    csig: "div.card",
    cls: "row",
    label: "Team",
    msg: "ring cut",
    crop: "crops/a/vw-390-0-focus-ring-clipped.png",
  };
  const records = [
    {
      capture: "settings-team",
      width: 390,
      probed: true,
      path: "/shop/x/settings/team",
      titlePath: TITLE,
      flags: [flag],
    },
    {
      capture: "settings-boats",
      width: 390,
      probed: true,
      path: "/shop/x/boats",
      titlePath: TITLE,
      flags: [flag],
    },
    {
      capture: "settings-boats",
      width: 1280,
      probed: false,
      skipped: "collecting geometry stalled",
      titlePath: TITLE,
    },
  ];
  const ledger = {
    "/shop/[shopSlug]/settings/team": { visual: ["settings-team"] },
    "/shop/[shopSlug]/boats": { visual: ["settings-boats"] },
  };

  it("makes one shared component's flaw one cluster across surfaces", () => {
    const report = buildReport(records, { ledger });
    expect(report.clusters).toHaveLength(1);
    expect([...report.clusters[0].captures]).toEqual(["settings-team", "settings-boats"]);
  });

  it("counts a skipped record as skipped, never as clean", () => {
    const report = buildReport(records, { ledger });
    expect(report.probed).toBe(2);
    expect(report.skipped).toEqual([
      { capture: "settings-boats", width: 1280, why: "collecting geometry stalled" },
    ]);
    expect(renderMarkdown(report)).toContain("## Skipped");
  });

  it("lists a settled flag with its reason instead of dropping it", () => {
    const settled = [
      {
        check: "focus-ring-clipped",
        signature: "summary.row",
        reason: "deliberate",
        pointer: "Rows.tsx:12",
      },
    ];
    const report = buildReport(records, { ledger, settled });
    expect(report.clusters).toEqual([]);
    expect(report.settled).toHaveLength(1);
    expect(renderMarkdown(report)).toContain("deliberate (Rows.tsx:12)");
  });

  it("passes capture evidence to contextual settlements and leaves old records open", () => {
    const contextual = {
      ...flag,
      el: 12,
      check: "ragged-edges",
      sig: "p.conditions",
      csig: "section.conditions",
      measure: { lefts: [4, 16, 16], mode: 16, strays: [{ sig: "p.conditions", off: -12 }] },
    };
    const settled = [
      {
        check: "ragged-edges",
        signature: "p.conditions",
        captures: ["site-briefing"],
        context: "conditions-line-separator",
        reason: "clip",
        pointer: "x",
      },
    ];
    const base = {
      capture: "site-briefing",
      width: 390,
      probed: true,
      path: "/s/x/trips/9",
      flags: [contextual],
    };
    expect(buildReport([base], { settled }).clusters).toHaveLength(1);
    const report = buildReport(
      [
        {
          ...base,
          settlementContext: {
            version: 1,
            conditionsLine: [{ el: 12, mode: 16 }],
          },
        },
      ],
      { settled },
    );
    expect(report.clusters).toEqual([]);
    expect(report.settled).toHaveLength(1);
  });
});

describe("table cells", () => {
  it("escapes a backslash before a pipe, so a class string cannot break the table", () => {
    const flag = {
      check: "small-target",
      severity: "S2",
      sig: "a.[&>svg]:size-4",
      csig: "",
      cls: "a\\|b",
      label: "x",
      msg: "ends in a backslash \\",
    };
    const report = buildReport(
      [{ capture: "c", width: 390, probed: true, path: "/", titlePath: TITLE, flags: [flag] }],
      {},
    );
    const markdown = renderMarkdown(report);
    // The source text a\|b: its backslash doubled, then its pipe escaped.
    expect(markdown).toContain("a\\\\\\|b");
    // A trailing backslash can no longer swallow the cell's closing pipe.
    expect(markdown).toContain("ends in a backslash \\\\");
  });
});

describe("tiles", () => {
  it("cuts a tall phone capture into 390×1560 tiles with a short last one", () => {
    const cells = tileGrid(390, 4000, { width: 390, height: 1560 });
    expect(cells.map((cell) => [cell.y, cell.height])).toEqual([
      [0, 1560],
      [1560, 1560],
      [3120, 880],
    ]);
  });
});
