import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditBaseline, importsOf, resolveSpecifier } from "./check-architecture.mjs";
import { collectSubstrateLeaves } from "./substrate-leaves.mjs";

async function leaves(files, primitives = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "substrate-leaves-"));
  for (const [file, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  return collectSubstrateLeaves(root, { importsOf, resolveSpecifier }, primitives);
}

describe("substrate leaves", () => {
  it("does not count a route, feature, test or fixture as a substrate importer", async () => {
    const result = await leaves({
      "src/lib/leaf.ts": "export const leaf = 1;",
      "src/app/page.tsx": 'import { leaf } from "@/lib/leaf";',
      "src/features/example/index.ts": 'export { leaf } from "@/lib/leaf";',
      "src/lib/leaf.test.ts": 'import { leaf } from "./leaf";',
      "src/db/leaf.spec.ts": 'import { leaf } from "../lib/leaf";',
      "src/test/fixture.ts": 'import { leaf } from "@/lib/leaf";',
    });
    expect([...result.keys()]).toEqual(["src/lib/leaf.ts"]);
  });

  it("resolves type edges, nested relative paths, aliases, explicit extensions and indexes", async () => {
    const result = await leaves({
      "src/lib/types.ts": "export type A = string;",
      "src/lib/nested/index.ts": 'export type { A } from "../types";',
      "src/db/read.ts":
        'import type { A } from "@/lib/nested";\nexport { x } from "../lib/exact.ts";\n',
      "src/lib/exact.ts": "export const x = 1;",
    });
    expect([...result.keys()]).toEqual(["src/db/read.ts"]);
  });

  it("counts dynamic, require and side-effect edges without erasing dependency direction", async () => {
    const result = await leaves({
      "src/db/top.ts":
        'import "../lib/boot";\nconst a = import("@/lib/lazy");\nconst b = require("../lib/cjs");',
      "src/lib/boot.ts": "",
      "src/lib/lazy.ts": "",
      "src/lib/cjs.ts": "",
    });
    expect([...result.keys()]).toEqual(["src/db/top.ts"]);
  });

  it("leaves a cycle in the knot but never treats a self-import as fan-in", async () => {
    const result = await leaves({
      "src/lib/a.ts": 'import "./b";',
      "src/lib/b.ts": 'import "./a";',
      "src/lib/self.ts": 'import "./self";',
    });
    expect([...result.keys()]).toEqual(["src/lib/self.ts"]);
  });

  it("exempts schema declarations and exact documented primitives, not neighboring leaves", async () => {
    const result = await leaves(
      {
        "src/db/schema/columns.ts": "export const column = 1;",
        "src/lib/check-in.ts": "export const isSettledAtCounter = () => false;",
        "src/lib/check-in-report.ts": "export const report = () => [];",
      },
      { "src/lib/check-in.ts": "Counter predicates are shared by the offline dock UI." },
    );
    expect([...result.keys()]).toEqual(["src/lib/check-in-report.ts"]);
  });

  it("refuses a stale or unexplained primitive exemption", async () => {
    const result = await leaves(
      { "src/lib/leaf.ts": "" },
      {
        "src/lib/typo.ts": "Shared offline counter predicate provider.",
        "src/lib/leaf.ts": "",
      },
    );
    expect(result.get("src/lib/typo.ts")).toEqual([expect.stringContaining("registry entry")]);
    expect(result.get("src/lib/leaf.ts")).toEqual([
      expect.stringContaining("no production substrate importer"),
    ]);
  });

  it("rejects a new leaf and requires banking a fall in the separate leaf ratchet", async () => {
    const result = await leaves({ "src/db/new-use-case.ts": "export const read = () => 1;" });
    expect(auditBaseline(result, {})).toEqual([
      expect.stringContaining("no production substrate importer"),
    ]);
    expect(auditBaseline(result, { "src/db/new-use-case.ts": 1 })).toEqual([]);
    expect(auditBaseline(new Map(), { "src/db/new-use-case.ts": 1 })).toEqual([
      expect.stringContaining("clean or gone"),
    ]);
  });
});
