#!/usr/bin/env node
import { hkdfSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [target, outputPath] = process.argv.slice(2);

if (!target || !outputPath || !["local", "vercel", "github"].includes(target)) {
  console.error(
    "Usage: node scripts/distribute-env.mjs <local|vercel|github> <output-file> < dotenv-document",
  );
  process.exit(2);
}

const source = readFileSync(0, "utf8");
const envLine = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const values = Object.fromEntries(
  source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(envLine);
    return match ? [[match[1], match[2]]] : [];
  }),
);

const seed = values.APP_SECRET_SEED;
if (!seed) {
  console.error(
    "The dotenv document has no APP_SECRET_SEED. Deploy the current CDK stack before distributing it.",
  );
  process.exit(1);
}

const derivedValue = (purpose) =>
  Buffer.from(hkdfSync("sha256", Buffer.from(seed), "diveday-app-secret-v1", purpose, 32)).toString(
    "base64",
  );

const resolvedValues = {
  ...values,
  AUTH_SECRET: derivedValue("auth"),
  SECRET_ENCRYPTION_KEY: derivedValue("credential-sealing"),
  CRON_SECRET: derivedValue("cron"),
};

const stackManaged = new Set([
  "AUTH_SECRET",
  "SECRET_ENCRYPTION_KEY",
  "CRON_SECRET",
  "APP_SECRET_SEED",
  "SES_SNS_TOPIC_ARN",
  "SMS_SNS_TOPIC_ARN",
  "REG_SUIT_S3_BUCKET_NAME",
  "REG_SUIT_AWS_ACCESS_KEY_ID",
  "REG_SUIT_AWS_SECRET_ACCESS_KEY",
]);

const localOnly = new Set([
  "APP_SECRET_SEED",
  "REG_SUIT_S3_BUCKET_NAME",
  "REG_SUIT_AWS_ACCESS_KEY_ID",
  "REG_SUIT_AWS_SECRET_ACCESS_KEY",
  "REG_SUIT_GITHUB_CLIENT_ID",
]);

const githubOnly = new Set([
  "REG_SUIT_S3_BUCKET_NAME",
  "REG_SUIT_AWS_ACCESS_KEY_ID",
  "REG_SUIT_AWS_SECRET_ACCESS_KEY",
  "REG_SUIT_GITHUB_CLIENT_ID",
]);

function replaceValues(document, replacements) {
  return document
    .split("\n")
    .map((line) => {
      const match = line.match(envLine);
      if (!match || replacements[match[1]] === undefined) return line;
      return `${match[1]}=${replacements[match[1]]}`;
    })
    .join("\n");
}

let rendered;
if (target === "local") {
  const existingValues = existsSync(outputPath)
    ? Object.fromEntries(
        readFileSync(outputPath, "utf8")
          .split(/\r?\n/)
          .flatMap((line) => {
            const match = line.match(envLine);
            return match ? [[match[1], match[2]]] : [];
          }),
      )
    : {};
  const mergedValues = Object.fromEntries(
    Object.entries(resolvedValues).map(([key, value]) => [
      key,
      !stackManaged.has(key) && existingValues[key] ? existingValues[key] : value,
    ]),
  );
  rendered = replaceValues(source, mergedValues);
} else {
  const included = Object.entries(resolvedValues)
    .filter(([_key, value]) => value !== "")
    .filter(([key]) => (target === "vercel" ? !localOnly.has(key) : githubOnly.has(key)))
    .map(([key, value]) => `${key}=${value}`);
  rendered = [`# Generated from diveday/env for ${target}; do not edit.`, ...included, ""].join(
    "\n",
  );
}

writeFileSync(outputPath, rendered);
