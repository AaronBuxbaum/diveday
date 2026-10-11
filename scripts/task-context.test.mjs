import path from "node:path";

import { describe, expect, it } from "vitest";

import { areaList, renderArea } from "./task-context.mjs";
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
