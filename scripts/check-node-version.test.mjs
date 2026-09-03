import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

describe("findNodeVersionDrift", () => {
  it("is silent on the tree as it stands", () => {
    expect(findNodeVersionDrift(readerFor(repoFiles()))).toEqual([]);
  });

  it("catches an engines floor that drifts from the one dependencies impose", () => {
    // The original bug: `>=24.0.0` looks right and admits Node 24.0-24.14,
    // which jsdom refuses.
    const files = repoFiles();
    files.set("package.json", files.get("package.json").replace(NODE_FLOOR, "24.0.0"));
    expect(findNodeVersionDrift(readerFor(files))).toEqual([
      `package.json (engines.node) says >=24.0.0, and every other declaration says >=${NODE_FLOOR}.`,
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

  it("keeps the floor at or above what every installed dependency asks for", () => {
    // Derived, not asserted: this is what makes the floor honest rather than
    // decorative, and it fails when a dependency bump raises the bar.
    const jsdom = JSON.parse(
      readFileSync(path.join(ROOT, "node_modules/jsdom/package.json"), "utf8"),
    );
    const forThisMajor = jsdom.engines.node
      .split("||")
      .map((range) => range.trim())
      .find((range) => range.includes(`${NODE_MAJOR}.`));
    expect(forThisMajor).toBe(`^${NODE_FLOOR}`);
  });

  it("is wired into pnpm check:repo, or it protects nothing", () => {
    const runner = readFileSync(path.join(ROOT, "scripts/check-repo.mjs"), "utf8");
    expect(runner).toContain('["node-version", "check-node-version.mjs"]');
  });
});
