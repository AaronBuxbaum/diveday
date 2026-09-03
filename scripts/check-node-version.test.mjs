import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Hoisted deliberately (`publicHoistPattern` in pnpm-workspace.yaml), and the
// right tool here: hand-rolling `||`/`^`/`>=` range logic to check a version
// range would be a subtler bug than the one this test exists to catch.
import { compare as compareVersions, satisfies, validRange } from "semver";
import { describe, expect, it } from "vitest";

import {
  findNodeVersionDrift,
  LAMBDA_NODE_MAJOR,
  NODE_FLOOR,
  NODE_MAJOR,
} from "./check-node-version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The tree as it stands, so a test can start from files that agree and break
 * exactly one of them. Reading the real files is the point: a fixture would
 * pass while the repository drifted, which is the failure this guard exists to
 * catch one level up.
 */
function repoFiles() {
  const files = new Map();
  for (const file of [
    "package.json",
    ".nvmrc",
    ".github/actions/setup/action.yml",
    "README.md",
    "infra/lib/infra-stack.ts",
    "infra/lib/visual-bucket-pruner.test.ts",
  ]) {
    files.set(file, readFileSync(path.join(ROOT, file), "utf8"));
  }
  return files;
}

const readerFor = (files) => (file) => files.get(file);

/**
 * Every installed package's `engines.node`, read off the pnpm store.
 *
 * The store is the honest place to look: `package.json`'s own dependency list
 * says what we asked for, and the floor is set by whatever those resolved to,
 * transitively.
 */
function installedNodeRanges() {
  const store = path.join(ROOT, "node_modules/.pnpm");
  const ranges = new Map();
  const collect = (directory, insideScope) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!insideScope && entry.name.startsWith("@")) {
        collect(path.join(directory, entry.name), true);
        continue;
      }
      const manifest = path.join(directory, entry.name, "package.json");
      if (!existsSync(manifest)) continue;
      let read;
      try {
        read = JSON.parse(readFileSync(manifest, "utf8"));
      } catch {
        continue;
      }
      if (read.engines?.node && validRange(read.engines.node)) {
        ranges.set(`${read.name}@${read.version}`, read.engines.node);
      }
    }
  };
  for (const packageDirectory of readdirSync(store)) {
    const base = path.join(store, packageDirectory, "node_modules");
    if (existsSync(base)) collect(base, false);
  }
  return ranges;
}

describe("findNodeVersionDrift", () => {
  it("is silent on the tree as it stands", () => {
    expect(findNodeVersionDrift(readerFor(repoFiles()))).toEqual([]);
  });

  it("catches an engines floor that drifts from the one dependencies impose", () => {
    // The original bug: `>=24.0.0` looks right and admits Node 24.0-24.14,
    // which jsdom refuses.
    const files = repoFiles();
    files.set("package.json", files.get("package.json").replace(`^${NODE_FLOOR}`, ">=24.0.0"));
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `package.json (engines.node) says >=24.0.0, and every other declaration says ^${NODE_FLOOR}.`,
    ]);
  });

  it("catches an engines range left open at the top of the major", () => {
    // The caret is load bearing: `>=24.15.0` also advertises every Node 25,
    // and jsdom excludes the whole odd major.
    const files = repoFiles();
    files.set(
      "package.json",
      files.get("package.json").replace(`^${NODE_FLOOR}`, `>=${NODE_FLOOR}`),
    );
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `package.json (engines.node) says >=${NODE_FLOOR}, and every other declaration says ^${NODE_FLOOR}.`,
    ]);
  });

  it("catches a version manager pointed at another major", () => {
    const files = repoFiles();
    files.set(".nvmrc", "22\n");
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `.nvmrc (the whole file) says 22, and every other declaration says ${NODE_MAJOR}.`,
    ]);
  });

  it("catches CI installing a different Node from the one the project declares", () => {
    const files = repoFiles();
    const action = ".github/actions/setup/action.yml";
    files.set(action, files.get(action).replace(/node-version: \d+/, "node-version: 22"));
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `${action} (node-version:) says 22, and every other declaration says ${NODE_MAJOR}.`,
    ]);
  });

  it("catches prose that stops matching the pin beside it", () => {
    // Two hits from one edit, which is the point: the action's own description
    // and the README both make a promise nothing else would notice breaking.
    const files = repoFiles();
    const action = ".github/actions/setup/action.yml";
    files.set(action, files.get(action).replace("Sets up pnpm, Node 24", "Sets up pnpm, Node 22"));
    files.set("README.md", files.get("README.md").replace("Requires Node 24", "Requires Node 22"));
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `${action} (the description prose) says 22, and every other declaration says ${NODE_MAJOR}.`,
      `README.md (the Quickstart line) says 22, and every other declaration says ${NODE_MAJOR}.`,
    ]);
  });

  it("catches a type surface describing a major nothing runs", () => {
    // How `@types/node: ^26` survived: nothing type-checks the types.
    const files = repoFiles();
    files.set(
      "package.json",
      files.get("package.json").replace(/"@types\/node": "\^\d+\./, '"@types/node": "^26.'),
    );
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `package.json (the @types/node major) says 26, and every other declaration says ${NODE_MAJOR}.`,
    ]);
  });

  it("catches one Lambda left behind on the old runtime", () => {
    // The shape that made a single stack run two majors: three of the seven
    // functions AWS ends up with come from aws-cdk-lib and follow its latest,
    // so a stale explicit pin is invisible in the diff and visible only in the
    // synthesized template.
    const files = repoFiles();
    const stack = "infra/lib/infra-stack.ts";
    files.set(
      stack,
      files.get(stack).replace("lambda.Runtime.NODEJS_24_X", "lambda.Runtime.NODEJS_22_X"),
    );
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `${stack} (every Lambda runtime) says lambda.Runtime.NODEJS_22_X, lambda.Runtime.NODEJS_24_X, and every other declaration says lambda.Runtime.NODEJS_${LAMBDA_NODE_MAJOR}_X.`,
    ]);
  });

  it("catches a bundling target compiled for a runtime that will not run it", () => {
    const files = repoFiles();
    const stack = "infra/lib/infra-stack.ts";
    files.set(stack, files.get(stack).replace('target: "node24"', 'target: "node22"'));
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `${stack} (the esbuild bundling target) says target: "node22", and every other declaration says target: "node${LAMBDA_NODE_MAJOR}".`,
    ]);
  });

  it("catches the synthesized-runtime assertion drifting from the runtime", () => {
    const files = repoFiles();
    const spec = "infra/lib/visual-bucket-pruner.test.ts";
    files.set(spec, files.get(spec).replace('Runtime: "nodejs24.x"', 'Runtime: "nodejs22.x"'));
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `${spec} (the synthesized-runtime assertion) says nodejs22.x, and every other declaration says nodejs${LAMBDA_NODE_MAJOR}.x.`,
    ]);
  });

  it("names a declaration file that has gone missing rather than passing without it", () => {
    // A guard that reads a deleted file as "nothing to check" is worse than no
    // guard: it goes green precisely when the pin it protects is gone.
    const files = repoFiles();
    files.delete(".nvmrc");
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      ".nvmrc is missing — it is one of this repo's Node-version declarations.",
    ]);
  });

  it("reports rather than throws when a declaration file cannot be parsed", () => {
    const files = repoFiles();
    files.set("package.json", "{ not json");
    const drift = findNodeVersionDrift(readerFor(files));
    expect(drift).toHaveLength(2);
    expect(drift[0]).toMatch(/^package\.json could not be read for engines\.node: /);
  });
});

describe("the numbers themselves", () => {
  it("keeps the floor inside the major it is a floor for", () => {
    expect(NODE_FLOOR.startsWith(`${NODE_MAJOR}.`)).toBe(true);
  });

  it("is the lowest version on this major that every installed dependency accepts", () => {
    // Derived from the whole graph, not from the one package that happens to
    // set it today: reading `jsdom` alone would stay green while some other
    // dependency raised the bar underneath it, which is the invariant this
    // test's name claims and the reason `engines` was wrong to begin with.
    // 733 of 1169 installed manifests declare a range; the scan costs ~0.15s.
    const ranges = installedNodeRanges();
    const offenders = [...ranges].filter(([, range]) => !satisfies(NODE_FLOOR, range));
    expect(offenders.map(([name, range]) => `${name} wants ${range}`)).toEqual([]);

    // And not needlessly high: nothing below the floor would do. Candidates
    // are every version on this major that any range names, since a range can
    // only change its answer at a boundary it mentions.
    const candidates = [`${NODE_MAJOR}.0.0`];
    for (const range of ranges.values()) {
      for (const version of range.match(
        new RegExp(`\\b${NODE_MAJOR}\\.\\d+(?:\\.\\d+)?\\b`, "g"),
      ) ?? []) {
        candidates.push(version.split(".").length === 2 ? `${version}.0` : version);
      }
    }
    const lowest = [...new Set(candidates)]
      .sort(compareVersions)
      .find((candidate) => [...ranges.values()].every((range) => satisfies(candidate, range)));
    expect(lowest).toBe(NODE_FLOOR);
  });

  it("is wired into pnpm check:repo, or it protects nothing", () => {
    const runner = readFileSync(path.join(ROOT, "scripts/check-repo.mjs"), "utf8");
    expect(runner).toContain('["node-version", "check-node-version.mjs"]');
  });
});
