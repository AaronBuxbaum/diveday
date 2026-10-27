#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

export const CI_JOBS = [
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

/** The aggregate is green only when every expected result exists and required lanes ran. */
export function ciMergeVerdict(needs, { code, db, event, ref = "" }) {
  const problems = [];
  if (!["true", "false"].includes(code) || !["true", "false"].includes(db))
    problems.push("change detection outputs are missing or invalid");
  if (!["pull_request", "push", "workflow_dispatch"].includes(event))
    problems.push("unsupported CI event");
  const required = new Set([
    "changes",
    "repo-safeguards",
    code === "true" ? "unit-tests" : "unit-tests-docs",
  ]);
  if (code === "true")
    for (const id of [
      "build",
      "playwright",
      "visual-plan",
      "visual",
      "visual-report",
      "coverage-floors",
    ])
      required.add(id);
  if (db === "true") required.add("real-postgres");
  if (code === "true" && ["push", "workflow_dispatch"].includes(event) && ref === "refs/heads/main")
    required.add("visual-flakes");
  for (const id of CI_JOBS) {
    const result = needs?.[id]?.result;
    if (result !== "success" && (result !== "skipped" || required.has(id)))
      problems.push(`${id}: ${result ?? "missing"}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const needs = JSON.parse(process.env.CI_NEEDS ?? "null");
    const problems = ciMergeVerdict(needs, {
      code: needs?.changes?.outputs?.code,
      db: needs?.changes?.outputs?.db,
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
    });
    if (problems.length) {
      console.error(`CI result: ${problems.join(", ")}`);
      process.exitCode = 1;
    } else console.log("CI result: all required jobs passed");
  } catch (error) {
    console.error(`CI result: invalid evidence: ${error.message}`);
    process.exitCode = 1;
  }
}
