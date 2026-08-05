#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [inputPath, environment = "production"] = process.argv.slice(2);
if (!inputPath || !["production", "preview", "development"].includes(environment)) {
  console.error(
    "Usage: node scripts/import-vercel-env.mjs <dotenv-file> [production|preview|development]",
  );
  process.exit(2);
}

const entries = readFileSync(inputPath, "utf8")
  .split(/\r?\n/)
  .flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
    return match ? [[match[1], match[2]]] : [];
  });

for (const [key, value] of entries) {
  // Do not put a secret in argv or terminal output. The Vercel CLI reads each
  // value from stdin; --force makes rerunning a rotation deterministic.
  const result = spawnSync(
    "pnpm",
    ["exec", "vercel", "env", "add", key, environment, "--force", "--sensitive"],
    { input: value, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
