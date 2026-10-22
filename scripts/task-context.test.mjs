import path from "node:path";

import { describe, expect, it } from "vitest";

import { areaList, matchAreas, pathPacket, recipeForPath, renderArea } from "./task-context.mjs";
import { areas } from "./task-context-data.mjs";

const ROOT = path.join(import.meta.dirname, "..");

describe("pnpm task:context", () => {
  it("lists every area with its goal when given none", () => {
    const list = areaList();
    for (const name of Object.keys(areas)) expect(list).toContain(name);
    expect(list.split("\n")[0]).toBe("Usage: pnpm task:context <area>");
  });

  it("has an area for each kind of work the last two weeks touched", () => {
    for (const name of [
      "schedule",
      "boats",
      "dive-sites",
      "integrations",
      "offline-manifests",
      "setup-links",
      "work-orders",
      "retention",
      "i18n",
    ]) {
      expect(areas[name], name).toBeDefined();
    }
  });

  it("gives every area a goal, paths, invariants and a focused validation", () => {
    for (const [name, area] of Object.entries(areas)) {
      expect(area.goal, name).toBeTruthy();
      expect(area.docs.length + area.code.length, name).toBeGreaterThan(0);
      expect(area.invariants.length, name).toBeGreaterThan(0);
      expect(area.validate.length, name).toBeGreaterThan(0);
    }
  });

  it("never prescribes a command the shell guard refuses (a bare whole suite)", () => {
    for (const [name, area] of Object.entries(areas)) {
      for (const command of area.validate) {
        expect(command, name).not.toMatch(/^pnpm (check|test|e2e)( --reporter=\w+)?$/);
      }
    }
  });

  it("renders an area with every path present", async () => {
    const text = await renderArea(ROOT, "work-orders");
    expect(text).toMatch(/^# Task context: work-orders/);
    expect(text).not.toContain("planned or not present yet");
  });
});

describe("bounded path packets", () => {
  it("refuses paths outside the checkout", () => {
    expect(() => pathPacket(ROOT, "../secret")).toThrow();
  });
  it("does not assign entire e2e or app trees", () => {
    const packet = pathPacket(ROOT, "src/db/bookings.ts");
    expect(packet.tests).not.toContain("e2e");
    expect(packet.read).toContain(".claude/rules/db.md");
    expect(packet.invariants.length).toBeGreaterThan(0);
  });
  it("leaves unrelated files to the route map", () => {
    expect(matchAreas("unknown-file.ts")).toEqual([]);
  });
});

it("routes common visual changes to concrete recipe IDs", () => {
  expect(matchAreas("src/components/ui/button.ts")).toEqual(["design"]);
  expect(recipeForPath("src/components/ui/button.ts")).toBe("forms");
  expect(recipeForPath("src/components/RowMenu.tsx")).toBe("row-actions");
  expect(recipeForPath("src/components/Toast.tsx")).toBe("feedback");
  expect(recipeForPath("src/app/shop/settings/SettingsRail.tsx")).toBe("settings");
  expect(recipeForPath("src/db/help-requests.ts")).toBe("handoff");
});
