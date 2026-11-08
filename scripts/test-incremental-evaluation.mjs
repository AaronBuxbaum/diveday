/** Isolated, bounded probes of Vitest's experimental recorded-dependency selector.
 * Run: node scripts/test-incremental-evaluation.mjs [path/to/node_modules]
 * No application tests, network, database, or repository cache are touched.
 */
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const modules = resolve(process.argv[2] || "node_modules");
const binary = join(modules, "vitest/vitest.mjs");
const version = JSON.parse(readFileSync(join(modules, "vitest/package.json"), "utf8")).version;
const workspace = mkdtempSync(join(tmpdir(), "diveday-incremental-"));
const results = [];
try {
  for (const scenario of [
    "unchanged",
    "static-import",
    "dynamic-import",
    "filesystem-read",
    "preserved-mtime",
    "environment",
    "setup",
    "new-test",
    "previous-failure",
    "deleted-import",
  ]) {
    const root = join(workspace, scenario);
    // mkdtemp is used so all fixture state is owned by this invocation.
    const fixture = mkdtempSync(root);
    symlinkSync(modules, join(fixture, "node_modules"), "dir");
    const put = (name, text) => writeFileSync(join(fixture, name), text);
    put(
      "vitest.config.mjs",
      `export default { test: { include: ['*.test.mjs'], setupFiles: ['./setup.mjs'], maxWorkers: 1 } };`,
    );
    put("setup.mjs", "globalThis.probeSetup = 1;");
    put("value.mjs", "export const value = 1;");
    put("dynamic.mjs", "export const value = 1;");
    put("data.txt", "1");
    put(
      "static.test.mjs",
      `import { test, expect } from 'vitest'; import { value } from './value.mjs'; test('static', () => expect(value).toBe(1));`,
    );
    put(
      "dynamic.test.mjs",
      `import { test, expect } from 'vitest'; test('dynamic', async () => { const file = './dynamic.mjs'; expect((await import(file)).value).toBe(1); });`,
    );
    put(
      "filesystem.test.mjs",
      `import { test, expect } from 'vitest'; import { readFileSync } from 'node:fs'; test('filesystem', () => expect(readFileSync(new URL('./data.txt', import.meta.url), 'utf8')).toBe('1'));`,
    );
    put(
      "environment.test.mjs",
      `import { test, expect } from 'vitest'; test('environment', () => expect(process.env.INCREMENTAL_PROBE).toBe('1'));`,
    );
    put(
      "setup.test.mjs",
      `import { test, expect } from 'vitest'; test('setup', () => expect(globalThis.probeSetup).toBe(1));`,
    );
    if (scenario === "previous-failure") put("value.mjs", "export const value = 2;");
    let probeEnv = "1";
    function run(incremental, relatedFile) {
      const report = join(fixture, "report.json");
      rmSync(report, { force: true });
      const start = performance.now();
      const child = runBounded(
        process.execPath,
        [
          binary,
          ...(relatedFile ? ["related", relatedFile, "--run"] : ["run"]),
          "--root",
          fixture,
          "--config",
          join(fixture, "vitest.config.mjs"),
          ...(incremental ? ["--since-last-run"] : []),
          "--passWithNoTests",
          "--reporter=json",
          "--outputFile",
          report,
        ],
        {
          cwd: fixture,
          timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
          encoding: "utf8",
          env: { ...process.env, INCREMENTAL_PROBE: probeEnv },
        },
      );
      if (child.error || ![0, 1].includes(child.status))
        throw new Error(`Probe failed: ${child.error || child.stderr}`);
      let reportData;
      try {
        reportData = JSON.parse(readFileSync(report, "utf8"));
      } catch {
        throw new Error(`Missing probe report: ${child.stderr} ${child.stdout}`);
      }
      return {
        milliseconds: Math.round(performance.now() - start),
        exitCode: child.status,
        selected: reportData.testResults.map((test) => basename(test.name)).sort(),
        failed: reportData.testResults
          .filter((test) => test.status === "failed")
          .map((test) => basename(test.name))
          .sort(),
      };
    }
    const cold = run(true);
    if (cold.selected.length !== 5)
      throw new Error(`Cold probe did not run all tests: ${scenario}`);
    if (scenario === "static-import") put("value.mjs", "export const value = 2;");
    if (scenario === "dynamic-import") put("dynamic.mjs", "export const value = 2;");
    if (scenario === "filesystem-read") put("data.txt", "2");
    if (scenario === "preserved-mtime") {
      const file = join(fixture, "value.mjs");
      const before = statSync(file);
      put("value.mjs", "export const value = 2;");
      utimesSync(file, before.atime, before.mtime);
    }
    if (scenario === "environment") probeEnv = "2";
    if (scenario === "setup") put("setup.mjs", "globalThis.probeSetup = 2;");
    if (scenario === "new-test")
      put(
        "new.test.mjs",
        `import { test, expect } from 'vitest'; test('new', () => expect(2).toBe(1));`,
      );
    if (scenario === "deleted-import") rmSync(join(fixture, "value.mjs"));
    const incremental = run(true);
    const changedInput = {
      "static-import": "value.mjs",
      "dynamic-import": "dynamic.mjs",
      "filesystem-read": "data.txt",
      "preserved-mtime": "value.mjs",
      setup: "setup.mjs",
      "new-test": "new.test.mjs",
      "deleted-import": "value.mjs",
    }[scenario];
    const related = changedInput ? run(false, changedInput) : null;
    const full = run(false);
    results.push({
      scenario,
      cold,
      incremental,
      related,
      full,
      missedFailures: full.failed.filter((name) => !incremental.failed.includes(name)),
    });
  }
  console.log(JSON.stringify({ vitest: version, node: process.version, results }, null, 2));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
