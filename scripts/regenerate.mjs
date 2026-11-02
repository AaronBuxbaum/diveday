import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * `pnpm regen`: rewrite every generated file a merge can leave stale, in one command.
 *
 * The merge drivers in `scripts/merge-drivers.mjs` keep a merge from stopping on these files;
 * this puts their content right afterwards. Each step is the command its own guard already
 * names, so nothing here decides a number: a ratchet that *grew* is still refused, and the
 * output says to `--absorb "<why>"` it, as a merge that brought in older work should.
 *
 * `--no-snapshot` skips the export-bundle snapshot, the one step that seeds a database.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Ratchet sections written by another guard's `--write` rather than a script of their own. */
const WRITTEN_BY = { "file-length": "page-length", "function-length": "page-length" };

export function ratchetScripts(root = ROOT) {
  const ratchets = JSON.parse(readFileSync(path.join(root, "scripts/ratchets.json"), "utf8"));
  const guards = Object.keys(ratchets)
    .filter((key) => !key.startsWith("//"))
    .map((guard) => WRITTEN_BY[guard] ?? guard);
  return [...new Set(guards)]
    .map((guard) => `scripts/check-${guard}.mjs`)
    .filter((script) => existsSync(path.join(root, script)));
}

export function steps({ root = ROOT, snapshot = true } = {}) {
  return [
    { label: "ADR index", command: "node", args: ["scripts/adr-index.mjs", "--write"] },
    {
      label: "human decision index",
      command: "node",
      args: ["scripts/check-human-decisions.mjs", "--write"],
    },
    { label: "glossary index", command: "node", args: ["scripts/check-glossary.mjs", "--write"] },
    ...ratchetScripts(root).map((script) => ({
      label: `ratchet ${path.basename(script, ".mjs").replace(/^check-/, "")}`,
      command: "node",
      args: [script, "--write"],
    })),
    ...(snapshot
      ? [
          {
            label: "export-bundle snapshot",
            command: "pnpm",
            args: ["exec", "vitest", "run", "src/db/export-bundle.snapshot.test.ts", "-u"],
            timeoutMs: SUBPROCESS_TIMEOUTS.regenerateSnapshot,
          },
        ]
      : []),
  ];
}

function main() {
  const snapshot = !process.argv.includes("--no-snapshot");
  let failed = 0;
  for (const step of steps({ snapshot })) {
    const result = runBounded(step.command, step.args, {
      cwd: ROOT,
      encoding: "utf8",
      timeoutMs: step.timeoutMs ?? SUBPROCESS_TIMEOUTS.nodeScript,
    });
    if (result.status === 0) {
      console.log(`regen: ${step.label} ok`);
      continue;
    }
    failed += 1;
    console.error(`regen: ${step.label} FAILED — ${step.command} ${step.args.join(" ")}`);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n");
    console.error(output.slice(-15).join("\n"));
  }
  const changed = runBounded("git", ["status", "--short"], {
    cwd: ROOT,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  console.log(`regen: working tree now\n${changed.stdout?.trim() || "(clean)"}`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
