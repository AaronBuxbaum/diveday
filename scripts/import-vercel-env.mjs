#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [inputPath, environment = "production"] = process.argv.slice(2);
if (!inputPath || !["production", "preview", "development"].includes(environment)) {
  console.error(
    "Usage: node scripts/import-vercel-env.mjs <dotenv-file> [production|preview|development]",
  );
  process.exit(2);
}

// `(.*)`, not `(.+)`: a deliberately blank value must still be diffed and
// pushed, not silently dropped from both the checkpoint and the sync.
const envLine = /^([A-Z][A-Z0-9_]*)=(.*)$/;
function parseDotenv(content) {
  return new Map(
    content.split(/\r?\n/).flatMap((line) => {
      const match = line.match(envLine);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
}

const document = readFileSync(inputPath, "utf8");
const entries = parseDotenv(document);

// Every value is pushed with `--sensitive` below, and Vercel never returns a
// sensitive value again once set -- not to the dashboard, not to `vercel env
// pull`, not to the API -- so there is nothing left to diff against what's
// live. The only diff available is against what this script itself last
// pushed, tracked in a local checkpoint next to the source file, exactly
// like `sync-github-secrets.mjs` does for the GitHub secrets API, which has
// the same write-only shape. A value edited directly in the Vercel dashboard
// is invisible to this check and will read as still in sync -- a known
// limit, not a bug.
const checkpointPath = `${inputPath}.synced.${environment}`;
const previous = existsSync(checkpointPath)
  ? parseDotenv(readFileSync(checkpointPath, "utf8"))
  : new Map();

const changed = [...entries].filter(([key, value]) => previous.get(key) !== value);

if (changed.length === 0) {
  console.log(`No ${environment} Vercel environment variables changed; nothing pushed.`);
  process.exit(0);
}

for (const [key, value] of changed) {
  // Do not put a secret in argv or terminal output. The Vercel CLI reads each
  // value from stdin; --force makes rerunning a rotation deterministic.
  const result = spawnSync(
    "pnpm",
    ["exec", "vercel", "env", "add", key, environment, "--force", "--sensitive"],
    { input: value, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Only recorded after every push succeeds, and as the full current document
// -- not just the changed subset -- so the next run's diff is against
// reality.
writeFileSync(checkpointPath, document);
console.log(
  `Pushed ${changed.length} of ${entries.size} ${environment} Vercel environment variable(s); the rest matched the last sync.`,
);
