import { describe, expect, it } from "vitest";

import {
  BRANCH_PREFIX,
  drillBranchName,
  logRow,
  newestDump,
  roleFromConnectionUris,
  scratchBranchProblem,
} from "./restore-drill.mjs";

describe("newestDump", () => {
  it("picks the newest dated dump and ignores anything not shaped like one", () => {
    const dump = newestDump([
      { Key: "dumps/2026-10-12/diveday.dump.gz", Size: 90_000 },
      { Key: "dumps/2026-10-19/diveday.dump.gz", Size: 91_000 },
      { Key: "dumps/2026-10-26/notes.txt", Size: 10 },
      { Key: "dumps/2026-10-26/diveday.dump.gz.partial", Size: 10 },
      { Key: "exports/2026-10-30/blue-mantis.zip", Size: 10 },
    ]);
    expect(dump).toEqual({
      key: "dumps/2026-10-19/diveday.dump.gz",
      date: "2026-10-19",
      bytes: 91_000,
    });
  });

  it("answers null for an empty bucket", () => {
    expect(newestDump(undefined)).toBeNull();
    expect(newestDump([])).toBeNull();
  });
});

describe("scratchBranchProblem", () => {
  const created = { id: "br-scratch-1", name: `${BRANCH_PREFIX}20261023-1200` };

  it("clears the branch this run created", () => {
    expect(scratchBranchProblem(created, "br-scratch-1")).toBeNull();
  });

  it("refuses the production branch, however it is described", () => {
    expect(scratchBranchProblem({ ...created, default: true }, "br-scratch-1")).toMatch(/default/);
    expect(scratchBranchProblem({ ...created, primary: true }, "br-scratch-1")).toMatch(/default/);
    expect(scratchBranchProblem({ ...created, protected: true }, "br-scratch-1")).toMatch(
      /protected/,
    );
    expect(scratchBranchProblem({ id: "br-main", name: "main" }, "br-main")).toMatch(/named/);
  });

  it("refuses a branch this run did not create, even one named like a drill", () => {
    expect(scratchBranchProblem({ ...created, id: "br-other" }, "br-scratch-1")).toMatch(
      /not the branch this run created/,
    );
    expect(scratchBranchProblem(undefined, "br-scratch-1")).toMatch(/not the branch/);
    expect(scratchBranchProblem(created, null)).toMatch(/not the branch/);
  });
});

describe("drillBranchName", () => {
  it("names the drill, the minute and the run", () => {
    const at = new Date("2026-10-23T12:34:56Z");
    expect(drillBranchName(at, "987")).toBe("restore-drill-20261023-1234-987");
    expect(drillBranchName(at, undefined)).toBe("restore-drill-20261023-1234");
  });
});

describe("roleFromConnectionUris", () => {
  it("reads the role Neon names, or the URI's user", () => {
    expect(roleFromConnectionUris([{ connection_parameters: { role: "neondb_owner" } }])).toBe(
      "neondb_owner",
    );
    expect(
      roleFromConnectionUris([
        { connection_uri: "postgresql://app_owner:pw@ep-x.neon.tech/neondb" },
      ]),
    ).toBe("app_owner");
    expect(roleFromConnectionUris([])).toBeNull();
    expect(roleFromConnectionUris([{ connection_uri: "not a url" }])).toBeNull();
  });
});

describe("logRow", () => {
  it("is one table row with no connection details in it", () => {
    const row = logRow({
      date: "2026-10-23",
      dumpDate: "2026-10-19",
      branchSeconds: 4,
      restoreSeconds: 31,
      outcome: "restored, signed in, manifest read",
    });
    expect(row.startsWith("| 2026-10-23 |")).toBe(true);
    expect(row.split("|")).toHaveLength(9);
    expect(row).toContain("dump 2026-10-19: restored, signed in, manifest read");
  });
});
