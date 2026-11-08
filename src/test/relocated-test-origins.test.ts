import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { needsDatabaseTimeout } from "./db-timeout";
import { classifyTestFile } from "./projects";
import {
  originalTestPath,
  RELOCATED_TEST_ORIGINS,
  RELOCATED_TEST_PROJECTS,
} from "./relocated-test-origins";

describe("relocated test ownership", () => {
  it("keeps every moved test in exactly its original project", () => {
    expect(Object.keys(RELOCATED_TEST_ORIGINS).length).toBeGreaterThan(0);
    for (const [file, project] of Object.entries(RELOCATED_TEST_PROJECTS)) {
      const source = readFileSync(resolve(file), "utf8");
      expect(classifyTestFile(file, source), file).toBe(project);
    }
  });

  it("keeps the database ceiling for moved database tests and Windows paths", () => {
    const moved = Object.entries(RELOCATED_TEST_ORIGINS).filter(([, original]) =>
      original.startsWith("src/db/"),
    );
    expect(moved.length).toBeGreaterThan(0);
    for (const [file] of moved) expect(needsDatabaseTimeout(resolve(file)), file).toBe(true);
    const file = moved[0][0];
    expect(needsDatabaseTimeout(`C:\\work\\diveday\\${file.replaceAll("/", "\\")}`)).toBe(true);
  });

  it("does not give a new feature test a historical layer or a wider ceiling", () => {
    const file = "src/features/future-concept/rules.test.ts";
    expect(originalTestPath(file)).toBe(file);
    expect(classifyTestFile(file, "export const value = 1;")).toBe("node");
    expect(needsDatabaseTimeout(file)).toBe(false);
  });
});
