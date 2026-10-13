import { describe, expect, it } from "vitest";

import {
  branchesWithoutPr,
  checks,
  gatherFacts,
  renderReport,
  summaryLines,
} from "./agent-doctor.mjs";

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
    expect(first).toContain("never fetched in this checkout");
    // The refusal tally belongs to the per-prompt line, said once; not repeated here.
    expect(first).not.toContain("refusal");
    expect(second).toContain("in no stack");
    expect(renderReport(sick)).toContain("git fetch origin main");
  });

  it("keeps what only a human can change out of the session-start line, and in the report", () => {
    const facts = { ...healthy, nodeMajor: 22, orphanBranches: ["claude/merged-1"] };
    const rows = checks(facts);
    expect(rows.find((row) => row.name === "node")).toMatchObject({ status: "info" });
    expect(rows.find((row) => row.name === "remote branches")).toMatchObject({ status: "info" });
    expect(summaryLines(facts)[0]).toBe("Doctor: nothing to warn about.");
    expect(renderReport(facts)).toContain("Node 22 (.nvmrc pins 24)");
    expect(renderReport(facts)).toContain("1 remote branches with no open PR");
  });

  it("has no GitHub MCP row, which a script could only ever call unknown, and names the tools under gh", () => {
    expect(checks(healthy).some((row) => row.name === "github-mcp")).toBe(false);
    const gh = checks({ ...healthy, gh: false }).find((row) => row.name === "gh");
    expect(gh.fix).toContain("mcp__github__get_me");
  });

  it("reads origin/main as current after the session's own fetch, and leaves a failed one to the block", () => {
    const readers = {
      git: (args) => (args.join(" ") === "log -1 --format=%cs origin/main" ? "2026-10-10" : null),
      pinnedMajor: () => 24,
      commandWorks: () => true,
      fetchAge: () => null,
      installNeed: () => null,
      readStack: () => null,
      readLog: () => [],
    };
    const fetched = gatherFacts("/repo", { strays: false, readers, fetched: "fetched" });
    expect(checks(fetched).find((row) => row.name === "origin/main").status).toBe("ok");
    const failed = gatherFacts("/repo", { strays: false, readers, fetched: "failed" });
    expect(checks(failed).find((row) => row.name === "origin/main").status).toBe("warn");
    expect(summaryLines(failed)[0]).toBe("Doctor: nothing to warn about.");
    const never = gatherFacts("/repo", { strays: false, readers });
    expect(summaryLines(never)[0]).toContain("never fetched in this checkout");
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

  it("leaves the remote-branch read to the on-demand report, off the session-start path", () => {
    let asked = false;
    const readers = {
      git: () => null,
      pinnedMajor: () => 24,
      commandWorks: () => true,
      fetchAge: () => 5_000,
      installNeed: () => null,
      readStack: () => null,
      readLog: () => [],
      remoteHeads: () => {
        asked = true;
        return ["main", "claude/merged-1", "claude/open-2"];
      },
      openPullHeads: () => ["claude/open-2"],
    };
    expect(gatherFacts("/repo", { strays: false, readers }).orphanBranches).toBeUndefined();
    expect(asked).toBe(false);
    const facts = gatherFacts("/repo", { strays: false, remote: true, readers });
    expect(facts.orphanBranches).toEqual(["claude/merged-1"]);
    const row = checks(facts).find((r) => r.name === "remote branches");
    expect(row).toMatchObject({ status: "info" });
    expect(row.detail).toBe("1 remote branches with no open PR (claude/merged-1)");
  });
});

describe("branchesWithoutPr", () => {
  it("is every head but main that no open pull request uses, or null when unread", () => {
    expect(branchesWithoutPr(["main", "b", "a", "c"], ["c"])).toEqual(["a", "b"]);
    expect(branchesWithoutPr(null, [])).toBeNull();
    expect(branchesWithoutPr(["a"], null)).toBeNull();
  });

  it("reports unknown, not ok, when GitHub could not answer", () => {
    const row = checks({ ...healthy, orphanBranches: null }).find(
      (r) => r.name === "remote branches",
    );
    expect(row.status).toBe("unknown");
  });
});
