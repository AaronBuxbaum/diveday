#!/usr/bin/env node
// Local selection only. CI continues to run every unit test.
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changedDiff } from "./e2e-affected.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST = /\.test\.(?:ts|tsx|mts|mjs|js)$/;
const DOC = /^(?:docs\/|\.claude\/)|\.md$/;
const GLOBAL =
  /^(?:package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|(?:vitest|vite|tsconfig)[^/]*\.|src\/test\/|src\/db\/schema\/|drizzle\/)/;
const KNOWN = /^(?:src\/|scripts\/|infra\/|e2e\/|docs\/|\.claude\/|\.github\/)|\.md$/;
const FILE_READER =
  /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?fs(?:\/promises)?["']/;

const READ_OPERATION =
  /\b(?:readFileSync|readFile|readdirSync|readdir|globSync|glob|opendirSync|opendir|createReadStream|readSync|readvSync|readv)\b/;

/** Conservative contract readers, including tests that also import app behavior. */
export function sourceReaders(root = ROOT) {
  try {
    // Reader modules are seeds too: native related follows their importers,
    // including tests using a wrapper rather than calling fs themselves.
    // Database fixture loaders read snapshot bytes, not source contracts;
    // changing any src/test input or migration still forces the full suite.
    const files = [...globSync("{src,infra,scripts}/**/*.{ts,tsx,mjs}", { cwd: root })].filter(
      (file) =>
        file !== "src/db/data-dir-lock.ts" &&
        !/^src\/test\/(?:db(?:-template(?:-read|-build)?)?|db-timeout|projects|shard-sequencer)\.ts$/.test(
          file,
        ),
    );
    return files
      .filter((file) => {
        const source = readFileSync(path.join(root, file), "utf8");
        return FILE_READER.test(source) && READ_OPERATION.test(source);
      })
      .sort();
  } catch {
    return null;
  }
}

function sharedTest(file) {
  try {
    // An exported fixture or a side-effect import can make a test an input to
    // another test. Keep native discovery whenever leaf status is uncertain.
    if (/\bexport\b/.test(readFileSync(path.join(ROOT, file), "utf8"))) return true;
    const name = path.basename(file).replace(/\.(?:ts|tsx|mts|mjs|js)$/, "");
    return [...globSync("{src,infra,scripts}/**/*.test.{ts,tsx,mjs}", { cwd: ROOT })].some(
      (other) => other !== file && readFileSync(path.join(ROOT, other), "utf8").includes(name),
    );
  } catch {
    return true;
  }
}

/** Native Vitest owns imports/aliases. Unknown dependencies always widen the run. */
export function testPlan({
  changed,
  readers,
  extra = [],
  isSharedTest = sharedTest,
  existing = (file) => existsSync(path.join(ROOT, file)),
}) {
  const reasons = [];
  const all = (reason) => ({ mode: "all", files: [], reasons: [reason] });
  if (changed.some((file) => GLOBAL.test(file)))
    return all("global test, schema, migration or dependency input changed");
  if (changed.some((file) => !KNOWN.test(file))) return all("unknown dependency input changed");
  if (changed.some((file) => !TEST.test(file) && !DOC.test(file) && !existing(file)))
    return all("production input deleted or renamed");
  const testsOnly =
    changed.length > 0 &&
    changed.some((file) => TEST.test(file)) &&
    changed.every((file) => TEST.test(file) || DOC.test(file));
  const documentsChanged = changed.some((file) => DOC.test(file));
  if (readers === null && documentsChanged) return all("source-reader discovery unavailable");
  if (
    testsOnly &&
    !(documentsChanged && readers?.some((file) => !TEST.test(file))) &&
    !changed.filter((file) => TEST.test(file) && existing(file)).some(isSharedTest)
  ) {
    return {
      mode: "direct",
      files: [
        ...new Set(
          [
            ...changed.filter((file) => TEST.test(file)),
            ...(changed.some((file) => DOC.test(file)) ? (readers ?? []) : []),
            ...extra,
          ].filter(existing),
        ),
      ].sort(),
      reasons: ["test-only diff: run edited tests directly"],
    };
  }
  if (readers === null) return all("source-reader discovery unavailable");
  const inputs = changed.filter((file) => !DOC.test(file) && existing(file));
  if (inputs.length) reasons.push("native Vitest import/alias dependency selection");
  if (readers?.length) reasons.push("conservative source-reader contracts");
  if (extra.length) reasons.push("base CI failures");
  return {
    mode: inputs.length || readers?.some((file) => !TEST.test(file)) ? "related" : "direct",
    files: [...new Set([...inputs, ...(readers ?? []), ...extra].filter(existing))].sort(),
    reasons,
  };
}

export function testArgs(selection) {
  return [
    "exec",
    "vitest",
    selection.mode === "related" ? "related" : "run",
    ...(selection.mode === "related" ? ["--run"] : []),
    "--project",
    "!guards",
    "--reporter=dot",
    ...selection.files,
  ];
}

function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  if (baseIndex >= 0 && !args[baseIndex + 1]) throw new Error("--base requires a ref");
  const diff = changedDiff({
    base: baseIndex >= 0 ? args[baseIndex + 1] : undefined,
    workingTree: true,
  });
  if (!diff) throw new Error("could not read the change base");
  const selection = testPlan({ changed: diff.changed, readers: sourceReaders() });
  console.log(
    `test:affected against ${diff.base}: ${selection.mode}; ${selection.files.length} explicit input(s).`,
  );
  for (const reason of selection.reasons) console.log(`  ${reason}`);
  const commands = [["exec", "vitest", "run", "--project", "guards", "--reporter=dot"]];
  if (selection.mode === "all" || selection.files.length > 0) commands.push(testArgs(selection));
  for (const command of commands) {
    console.log(`  pnpm ${command.join(" ")}`);
    if (args.includes("--plan")) continue;
    const result = runBounded("pnpm", command, {
      cwd: ROOT,
      stdio: "inherit",
      timeoutMs: SUBPROCESS_TIMEOUTS.verifyPushStep,
    });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
