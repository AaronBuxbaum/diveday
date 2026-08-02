import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const envExamplePath = path.join(ROOT, ".env.example");
const envLocalPath = path.join(ROOT, ".env.local");

// Helper to extract environment variable keys from an env file
function getEnvKeys(content) {
  const keys = new Set();
  const lines = content.split(/\r?\n/);
  // Match key=value or key=, ignore comments
  const keyRegex = /^[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*=/;
  for (const line of lines) {
    const match = line.match(keyRegex);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

async function run() {
  let exampleContent;
  try {
    exampleContent = await readFile(envExamplePath, "utf8");
  } catch {
    console.error(`❌ Error: .env.example not found at ${envExamplePath}`);
    process.exit(1);
  }

  const exampleKeys = getEnvKeys(exampleContent);
  if (exampleKeys.size === 0) {
    console.log("env: No keys defined in .env.example");
    process.exit(0);
  }

  let localContent;
  try {
    localContent = await readFile(envLocalPath, "utf8");
  } catch {
    // Local development and the test suite deliberately use embedded PGlite
    // and safe fallbacks when no real credentials are configured. `.env.local`
    // is therefore optional; only validate it when a developer has created it.
    console.log("env: .env.local not found; local development uses documented fallbacks");
    process.exit(0);
  }

  const localKeys = getEnvKeys(localContent);
  const missingKeys = [];

  for (const key of exampleKeys) {
    // SES is dormant prep (ADR 20260802-ses-email-transition-prep) — no real
    // credentials exist anywhere yet. Remove once EMAIL_PROVIDER=ses is a real
    // cutover, not a future option.
    if (key === "EMAIL_PROVIDER" || key.startsWith("SES_")) {
      continue;
    }
    if (!localKeys.has(key)) {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    console.error(
      `❌ Error: The following environment variables defined in .env.example are missing from .env.local:\n` +
        missingKeys.map((k) => `  - ${k}`).join("\n") +
        "\n\nThese variables might be missing from the Vercel project or need to be pulled.\n" +
        "Please add them to Vercel (or update your local configuration) and run `vercel env pull` to update .env.local.",
    );
    process.exit(1);
  }

  console.log("env: All entries from .env.example are present in .env.local");
}

run().catch((err) => {
  console.error("❌ Error running env check:", err);
  process.exit(1);
});
