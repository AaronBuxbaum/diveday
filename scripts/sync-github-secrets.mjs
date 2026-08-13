#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dotenvMap } from "./dotenv.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error("Usage: node scripts/sync-github-secrets.mjs <dotenv-file>");
  process.exit(2);
}

// A deliberately blank secret must still be diffed and pushed, not silently
// dropped from both the checkpoint and the sync -- `dotenvMap` keeps empty
// values for that reason.
const parseDotenv = dotenvMap;

const document = readFileSync(inputPath, "utf8");
const entries = parseDotenv(document);

// GitHub's Actions secrets API never returns a secret's value, to any token
// at any scope, so there is no way to ask GitHub "did this change." The only
// diff available is against what this script itself last pushed, tracked in
// a local checkpoint next to the source file. A secret edited directly in
// the GitHub UI or API is invisible to this check and will read as still in
// sync -- a known limit, not a bug.
const checkpointPath = `${inputPath}.synced`;
const previous = existsSync(checkpointPath)
  ? parseDotenv(readFileSync(checkpointPath, "utf8"))
  : new Map();

const changed = [...entries].filter(([key, value]) => previous.get(key) !== value);

if (changed.length === 0) {
  console.log("No GitHub secrets changed since the last sync; nothing pushed.");
  process.exit(0);
}

const stagingDirectory = mkdtempSync(join(tmpdir(), "diveday-github-secrets-"));
const stagingFile = join(stagingDirectory, "changed.env");
writeFileSync(stagingFile, changed.map(([key, value]) => `${key}=${value}`).join("\n"));

const result = spawnSync("gh", ["secret", "set", "--env-file", stagingFile], { stdio: "inherit" });
rmSync(stagingDirectory, { recursive: true, force: true });

if (result.status !== 0) process.exit(result.status ?? 1);

// Only recorded after a successful push, and as the full current document --
// not just the changed subset -- so the next run's diff is against reality.
writeFileSync(checkpointPath, document);
console.log(
  `Pushed ${changed.length} of ${entries.size} GitHub secret(s); the rest matched the last sync.`,
);
