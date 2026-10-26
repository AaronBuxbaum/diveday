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
  nodeVersion: "24.22.0",
  pinnedMajor: 24,
  gh: true,
  fetchAgeMs: 60_000,
  mainTip: "2026-10-10",
  nodeModules: null,
  strays: 0,
  stack: "stack: layer 2 of 3, top origin/claude/x-3",
  refusals: "",
  hooksCheckout: { dir: "/home/claude/diveday", detached: true, behind: 0 },
  mergeDriver: "node scripts/merge-drivers.mjs ratchets %O %A %B %P",
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
      nodeVersion: "22.22.2",
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
    expect(first).toContain("never fetched in this checkout");
    // The refusal tally belongs to the per-prompt line, said once; not repeated here.
    expect(first).not.toContain("refusal");
    expect(second).toContain("in no stack");
    expect(renderReport(sick)).toContain("git fetch origin main");
  });

  it("makes a repairable old minor visible while leaving remote branch advice informational", () => {
    const facts = { ...healthy, nodeVersion: "24.18.0", orphanBranches: ["claude/merged-1"] };
    const rows = checks(facts);
    expect(rows.find((row) => row.name === "node")).toMatchObject({ status: "warn" });
    expect(rows.find((row) => row.name === "remote branches")).toMatchObject({ status: "info" });
    expect(summaryLines(facts)[0]).toContain("Node 24.18.0");
    expect(renderReport(facts)).toContain("pnpm install --frozen-lockfile");
    expect(renderReport(facts)).toContain("1 remote branches with no open PR");
  });

  it("has no GitHub MCP row, which a script could only ever call unknown, and names the tools under gh", () => {
    expect(checks(healthy).some((row) => row.name === "github-mcp")).toBe(false);
    const gh = checks({ ...healthy, gh: false }).find((row) => row.name === "gh");
    expect(gh.fix).toContain("mcp__github__get_me");
  });

  it("reads origin/main as current after the session's own fetch, and leaves a failed one to the block", () => {
    const readers = {
      git: (args) =>
        ({
          "log -1 --format=%cs origin/main": "2026-10-10",
          "config --get merge.diveday-ratchets.driver": "node scripts/merge-drivers.mjs",
        })[args.join(" ")] ?? null,
      hooksCheckout: () => ({ dir: "/repo", detached: true, behind: 0 }),
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

describe("the checkout the hooks load from, and the merge drivers", () => {
  // 2026-10-13: every session's hooks came from a checkout 704 commits behind main.
  it("warns when the hooks' checkout is detached behind main, with the command that moves it", () => {
    const facts = {
      ...healthy,
      hooksCheckout: { dir: "/home/claude/diveday", detached: true, behind: 704 },
    };
    const row = checks(facts).find((r) => r.name === "hooks checkout");
    expect(row).toMatchObject({ status: "warn" });
    expect(row.detail).toBe("hooks run from /home/claude/diveday, 704 commits behind origin/main");
    expect(row.fix).toContain("git -C /home/claude/diveday checkout --detach origin/main");
    expect(summaryLines(facts)[0]).toContain("704 commits behind origin/main");
  });

  it("is quiet when that checkout is current, and only informs when it is on a branch", () => {
    expect(checks(healthy).find((r) => r.name === "hooks checkout").status).toBe("ok");
    const branch = {
      ...healthy,
      hooksCheckout: { dir: "/repo", detached: false, behind: 12 },
    };
    expect(checks(branch).find((r) => r.name === "hooks checkout").status).toBe("info");
    expect(
      checks({ ...healthy, hooksCheckout: null }).find((r) => r.name === "hooks checkout"),
    ).toMatchObject({ status: "unknown" });
  });

  // 2026-10-13: the drivers were defined in no clone config and merges stopped on ratchets.json.
  it("warns when the ratchet merge driver is not installed in this clone", () => {
    const facts = { ...healthy, mergeDriver: null };
    const row = checks(facts).find((r) => r.name === "merge drivers");
    expect(row).toMatchObject({ status: "warn" });
    expect(row.fix).toBe("node scripts/merge-drivers.mjs install");
    expect(summaryLines(facts)[0]).toContain("merge drivers are not installed");
    // Session start says a failed install itself; the summary does not say it twice.
    expect(summaryLines({ ...facts, mergeDriversInstall: "not installed" })[0]).toBe(
      "Doctor: nothing to warn about.",
    );
  });

  it("reads both through injectable readers", () => {
    const facts = gatherFacts("/repo", {
      strays: false,
      readers: {
        git: (args) =>
          args.join(" ") === "config --get merge.diveday-ratchets.driver" ? "node x" : null,
        pinnedMajor: () => 24,
        commandWorks: () => true,
        fetchAge: () => 5_000,
        installNeed: () => null,
        readStack: () => null,
        readLog: () => [],
        hooksCheckout: () => ({ dir: "/p", detached: true, behind: 3 }),
      },
    });
    expect(facts.mergeDriver).toBe("node x");
    expect(facts.hooksCheckout).toEqual({ dir: "/p", detached: true, behind: 3 });
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

describe("the scheduled-runs row", () => {
  const red = [
    {
      name: "Simulate a day",
      path: ".github/workflows/simulate-day.yml",
      streak: 26,
      since: "2026-09-18",
      url: "https://github.com/o/r/actions/runs/36",
    },
  ];

  it("warns at session start when a scheduled workflow is red twice running, with where to look", () => {
    const facts = { ...healthy, redScheduled: red };
    const row = checks(facts).find((r) => r.name === "scheduled runs");
    expect(row.status).toBe("warn");
    expect(row.fix).toContain(".github/workflows/simulate-day.yml");
    expect(row.fix).toContain("https://github.com/o/r/actions/runs/36");
    expect(summaryLines(facts)[0]).toBe(
      "Doctor: scheduled Simulate a day red 26 runs running (since 2026-09-18).",
    );
  });

  it("is ok when none is red, unknown when GitHub could not answer, and absent unless asked", () => {
    expect(
      checks({ ...healthy, redScheduled: [] }).find((r) => r.name === "scheduled runs"),
    ).toMatchObject({ status: "ok" });
    expect(
      checks({ ...healthy, redScheduled: null }).find((r) => r.name === "scheduled runs"),
    ).toMatchObject({ status: "unknown" });
    expect(checks(healthy).some((r) => r.name === "scheduled runs")).toBe(false);
  });

  it("reads the runs only when asked, through an injectable reader", () => {
    let asked = 0;
    const readers = {
      git: () => null,
      pinnedMajor: () => 24,
      commandWorks: () => true,
      fetchAge: () => 5_000,
      installNeed: () => null,
      readStack: () => null,
      readLog: () => [],
      scheduledRuns: () => {
        asked += 1;
        return [
          { ...red[0], conclusion: "failure", createdAt: "2026-10-13T06:30:00Z" },
          { ...red[0], conclusion: "failure", createdAt: "2026-10-12T06:30:00Z" },
        ];
      },
    };
    expect(gatherFacts("/repo", { strays: false, readers }).redScheduled).toBeUndefined();
    expect(asked).toBe(0);
    const facts = gatherFacts("/repo", { strays: false, scheduled: true, readers });
    expect(asked).toBe(1);
    expect(facts.redScheduled).toMatchObject([{ name: "Simulate a day", streak: 2 }]);
  });
});
