import { describe, expect, it } from "vitest";

import { checks, gatherFacts, renderReport, summaryLines } from "./agent-doctor.mjs";

const healthy = {
  nodeMajor: 24,
  pinnedMajor: 24,
  gh: true,
  fetchAgeMs: 60_000,
  mainTip: "2026-10-10",
  nodeModules: null,
  strays: 0,
  stack: "stack: layer 2 of 3, top origin/claude/x-3",
  refusals: "",
};

describe("the doctor's checks", () => {
  it("warns about nothing in a healthy environment, and still names the stack", () => {
    expect(summaryLines(healthy)).toEqual([
      "Doctor: nothing to warn about.",
      "Stack: layer 2 of 3, top origin/claude/x-3; `pnpm agent:doctor` for the full report.",
    ]);
  });

  it("names every problem a cloud session meets, each with its fix", () => {
    const sick = {
      ...healthy,
      nodeMajor: 22,
      gh: false,
      fetchAgeMs: null,
      mainTip: "2026-10-05",
      nodeModules: "stale",
      strays: 2,
      stack: "",
      refusals: "3 hook refusals last session (guard-bash 3): …",
    };
    const rows = checks(sick);
    const warned = rows.filter((row) => row.status === "warn").map((row) => row.name);
    expect(warned).toEqual([
      "node",
      "gh",
      "origin/main",
      "node_modules",
      "stray processes",
      "hook refusals",
    ]);
    for (const row of rows.filter((r) => r.status === "warn" && r.name !== "hook refusals")) {
      expect(row.fix).not.toBe("");
    }
    const [first, second] = summaryLines(sick);
    expect(first).toContain("Node 22 (.nvmrc pins 24)");
    expect(first).toContain("never fetched in this checkout");
    // The refusal tally belongs to the per-prompt line, said once; not repeated here.
    expect(first).not.toContain("refusal");
    expect(second).toContain("in no stack");
    expect(renderReport(sick)).toContain("git fetch origin main");
  });

  it("never claims the GitHub MCP server is reachable: a script cannot test it", () => {
    const mcp = checks(healthy).find((row) => row.name === "github-mcp");
    expect(mcp.status).toBe("unknown");
    expect(mcp.fix).toContain("mcp__github__get_me");
  });

  it("gathers through injectable readers, leaving strays out when asked", () => {
    const facts = gatherFacts("/repo", {
      strays: false,
      readers: {
        git: (args) => (args.join(" ") === "log -1 --format=%cs origin/main" ? "2026-10-10" : null),
        pinnedMajor: () => 24,
        commandWorks: () => false,
        fetchAge: () => 5_000,
        installNeed: () => null,
        readStack: () => null,
        readLog: () => [],
      },
    });
    expect(facts).toMatchObject({ pinnedMajor: 24, gh: false, mainTip: "2026-10-10", stack: "" });
    expect(facts.strays).toBeUndefined();
    expect(checks(facts).some((row) => row.name === "stray processes")).toBe(false);
  });
});
