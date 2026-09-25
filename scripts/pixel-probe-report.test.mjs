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
      path: "/shop/x/settings/boats",
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
    "/shop/[shopSlug]/settings/boats": { visual: ["settings-boats"] },
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
