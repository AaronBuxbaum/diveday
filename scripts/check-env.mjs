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
    // SNS SMS is dormant prep (ADR 20260802-sns-sms-adapter) — no real
    // credentials exist anywhere yet. Remove once a shop actually needs it.
    if (key.startsWith("SNS_") || key === "SMS_SNS_TOPIC_ARN") {
      continue;
    }
    // The operational-alert destination is an override, not configuration
    // (ADR 20260805-demo-try-alerts): unset, both alerts go to the
    // ALERT_EMAIL mailbox compiled into src/lib/platform-mail.ts, which is
    // the correct answer for every deployment that *is* DiveDay. Only a fork,
    // a staging deploy, or a self-hosted instance has one to set.
    if (key === "OPS_ALERT_EMAIL") {
      continue;
    }
    // Provider usage guardrails are optional by design (ADR
    // 20260806-provider-usage-guardrails): with no token the affected ceiling
    // reports `not_configured` — which the monitor keeps distinct from `ok`
    // everywhere it surfaces — and nothing else changes. A local run, a fork,
    // or a deployment whose owner has not minted the read-only tokens
    // legitimately has none.
    if (key.startsWith("USAGE_")) {
      continue;
    }
    // Address lookup is optional by design (ADR
    // 20260804-aws-location-address-lookup): with no credentials the settings
    // address card is exactly the five text boxes it has always been, so a
    // local or self-hosted instance legitimately has none.
    if (key.startsWith("PLACES_")) {
      continue;
    }
    // WhatsApp is per-shop: the credentials live in shop_whatsapp_accounts, not
    // here. Only the sealing key is environment configuration, and an instance
    // with no shop using WhatsApp legitimately has none
    // (ADR 20260802-whatsapp-cloud-api-per-shop).
    if (key === "SECRET_ENCRYPTION_KEY" || key === "APP_SECRET_SEED" || key.startsWith("META_")) {
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
