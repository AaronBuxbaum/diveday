import { describe, expect, it } from "vitest";
import { ciMergeVerdict } from "./ci-merge-verdict.mjs";

const jobs = [
  "repo-safeguards",
  "unit-tests",
  "unit-tests-docs",
  "build",
  "playwright",
  "fast-lane",
  "visual-plan",
  "visual",
  "visual-report",
  "changes",
  "real-postgres",
  "coverage-floors",
  "visual-flakes",
];
const green = () => Object.fromEntries(jobs.map((id) => [id, { result: "success" }]));

describe("CI merge verdict", () => {
  it("accepts a full code run with only explicitly optional jobs skipped", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    needs["visual-flakes"].result = "skipped";
    expect(ciMergeVerdict(needs, { code: "true", db: "false", event: "pull_request" })).toEqual([]);
  });
  it("refuses missing, cancelled, unknown and improperly skipped mandatory jobs", () => {
    for (const result of ["skipped", "cancelled", "failure", "unknown", undefined]) {
      const needs = green();
      if (result === undefined) delete needs.build;
      else needs.build.result = result;
      expect(
        ciMergeVerdict(needs, { code: "true", db: "true", event: "pull_request" }),
      ).not.toEqual([]);
    }
  });
  it("requires documentation tests for docs-only changes and postgres for db changes", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    expect(ciMergeVerdict(needs, { code: "false", db: "true", event: "pull_request" })).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unit-tests-docs"),
        expect.stringContaining("real-postgres"),
      ]),
    );
  });
  it("accepts the intentional skips on a documentation-only pull request", () => {
    const needs = green();
    for (const id of [
      "unit-tests",
      "build",
      "playwright",
      "fast-lane",
      "visual-plan",
      "visual",
      "visual-report",
      "real-postgres",
      "coverage-floors",
      "visual-flakes",
    ])
      needs[id].result = "skipped";
    expect(ciMergeVerdict(needs, { code: "false", db: "false", event: "pull_request" })).toEqual(
      [],
    );
  });
  it("requires visual-flake reporting for a main code push", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    const context = { code: "true", db: "false", event: "push", ref: "refs/heads/main" };
    expect(ciMergeVerdict(needs, context)).toEqual([]);
    needs["visual-flakes"].result = "skipped";
    expect(ciMergeVerdict(needs, context)).toEqual(["visual-flakes: skipped"]);
  });
  it("fails closed when change detection evidence is missing or malformed", () => {
    expect(ciMergeVerdict(green(), { code: "", db: "false", event: "pull_request" })).not.toEqual(
      [],
    );
    expect(ciMergeVerdict(green(), { code: "true", db: "", event: "pull_request" })).not.toEqual(
      [],
    );
  });
});
