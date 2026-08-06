#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [inputPath, environment = "production"] = process.argv.slice(2);
if (!inputPath || !["production", "preview", "development"].includes(environment)) {
  console.error(
    "Usage: node scripts/import-vercel-env.mjs <dotenv-file> [production|preview|development]",
  );
  process.exit(2);
}

const envLine = /^([A-Z][A-Z0-9_]*)=(.*)$/;

// `vercel env pull` quotes values dotenv-style; the file we're importing
// from does not (see distribute-env.mjs). Unwrap one layer of quoting so a
// pulled value and a candidate value compare equal when they mean the same
// thing.
function unquote(raw) {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw;
  return raw
    .slice(1, -1)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function parseDotenv(content) {
  return new Map(
    content.split(/\r?\n/).flatMap((line) => {
      const match = line.match(envLine);
      return match ? [[match[1], unquote(match[2])]] : [];
    }),
  );
}

const entries = readFileSync(inputPath, "utf8")
  .split(/\r?\n/)
  .flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
    return match ? [[match[1], match[2]]] : [];
  });

// Diff against what Vercel already has so a rerun only pushes values that
// actually changed. `env add --force` unconditionally mints a new revision
// -- and can trigger a redeploy for anything that reads the var at build
// time -- so pushing an identical value is pure churn. If the pull fails
// for any reason, fall back to pushing everything rather than blocking the
// sync on an optimization.
let currentValues = new Map();
const pullDirectory = mkdtempSync(join(tmpdir(), "diveday-vercel-env-"));
const pullFile = join(pullDirectory, "pulled.env");
const pull = spawnSync(
  "pnpm",
  ["exec", "vercel", "env", "pull", pullFile, `--environment=${environment}`, "--yes"],
  { stdio: ["ignore", "inherit", "inherit"] },
);
if (pull.status === 0) {
  try {
    currentValues = parseDotenv(readFileSync(pullFile, "utf8"));
  } catch (error) {
    console.warn(
      `Could not read the pulled ${environment} environment variables (${error instanceof Error ? error.message : error}); pushing every value instead of only what changed.`,
    );
  }
} else {
  console.warn(
    `vercel env pull failed; pushing every ${environment} value instead of only what changed.`,
  );
}
rmSync(pullDirectory, { recursive: true, force: true });

let pushed = 0;
for (const [key, value] of entries) {
  if (currentValues.get(key) === value) continue;
  pushed += 1;
  // Do not put a secret in argv or terminal output. The Vercel CLI reads each
  // value from stdin; --force makes rerunning a rotation deterministic.
  const result = spawnSync(
    "pnpm",
    ["exec", "vercel", "env", "add", key, environment, "--force", "--sensitive"],
    { input: value, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  pushed === 0
    ? `No ${environment} Vercel environment variables changed; nothing pushed.`
    : `Pushed ${pushed} of ${entries.length} ${environment} Vercel environment variable(s); the rest were already up to date.`,
);
