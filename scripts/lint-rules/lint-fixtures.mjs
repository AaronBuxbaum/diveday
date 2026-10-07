import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "../subprocess.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BIOME = path.join(ROOT, "node_modules/.bin/biome");

/**
 * The repository's own `biome.json`, made to run somewhere else: plugin paths absolute (they
 * are relative to the config file), and VCS off, since a temporary directory is no checkout.
 * Everything else — the overrides that scope each rule and exempt its files — is the real
 * config, so a fixture is judged by exactly what `pnpm lint` would apply to it.
 */
function portableConfig() {
  const config = JSON.parse(readFileSync(path.join(ROOT, "biome.json"), "utf8"));
  const absolute = (plugin) =>
    typeof plugin === "string"
      ? path.join(ROOT, plugin)
      : { ...plugin, path: path.join(ROOT, plugin.path) };
  if (config.plugins) config.plugins = config.plugins.map(absolute);
  for (const override of config.overrides ?? []) {
    if (override.plugins) override.plugins = override.plugins.map(absolute);
  }
  config.vcs = { enabled: false };
  return config;
}

/**
 * Lint fixture files with the repository's Biome config and its plugins.
 *
 * `files` maps a repository-relative path to its contents; the path matters, because the
 * overrides that scope a rule match on it. Returns the plugin diagnostics, plus the
 * suppression and parse diagnostics a test of an escape hatch needs, each as
 * `{ file, line, rule, message }` with `rule` read off the message prefix (`clock: …`).
 *
 * `errored` collects a plugin that failed to *run* on a file. Biome reports that as an info
 * diagnostic and exits 0, so a broken rule would otherwise pass every refusal test silently.
 */
export function lintFixtures(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "lint-rules-"));
  try {
    writeFileSync(path.join(dir, "biome.json"), JSON.stringify(portableConfig()));
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), contents);
    }
    const result = runBounded(
      BIOME,
      ["lint", "--reporter=json", "--max-diagnostics=none", ...Object.keys(files)],
      { cwd: dir, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.biomeFile },
    );
    const report = JSON.parse(result.stdout);
    const diagnostics = [];
    const errored = [];
    for (const diagnostic of report.diagnostics) {
      const entry = {
        file: diagnostic.location?.path,
        line: diagnostic.location?.start?.line,
        category: diagnostic.category,
        rule: diagnostic.message.match(/^(\w+):/)?.[1],
        message: diagnostic.message,
      };
      if (diagnostic.category === "plugin" && / errored: /.test(diagnostic.message))
        errored.push(entry);
      else if (
        diagnostic.category === "plugin" ||
        /^(suppressions|parse)/.test(diagnostic.category)
      )
        diagnostics.push(entry);
    }
    return { status: result.status, diagnostics, errored };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The `file:line` of every diagnostic one rule raised, in report order. */
export function refusals(files, rule) {
  const { diagnostics, errored } = lintFixtures(files);
  if (errored.length > 0)
    throw new Error(`a lint rule failed to run: ${errored.map((e) => e.message).join("; ")}`);
  return diagnostics
    .filter((diagnostic) => diagnostic.rule === rule)
    .map((diagnostic) => `${diagnostic.file}:${diagnostic.line}`)
    .sort();
}
