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

/**
 * The per-service AWS credential triples the stack mints -- `SES_AWS_*`,
 * `SNS_AWS_*`, `PLACES_AWS_*`, `CLOUDWATCH_AWS_*`, and whatever the next
 * section adds.
 *
 * Matched by shape rather than listed, because the list is what failed. The
 * set above named the SNS *topic ARNs* the stack writes but not the IAM pairs
 * it mints beside them, so `PLACES_AWS_ACCESS_KEY_ID` fell through the local
 * merge: a key typed onto that line once outlived every later deploy, which
 * read the real one out of Secrets Manager and dropped it. A name-shaped rule
 * cannot be forgotten the next time a service is added.
 *
 * There is no local override for these on purpose. They are credentials an
 * IAM user holds, not a developer preference -- a private copy is a stale copy
 * waiting to happen, and this file is the only place it could come from.
 */
const MINTED_AWS_CREDENTIAL = /_AWS_(REGION|ACCESS_KEY_ID|SECRET_ACCESS_KEY)$/;

/**
 * Whether the deployed stack, rather than the file already on disk, decides
 * this value. Gated on the stack actually having one: a key the stack does not
 * carry (an older deploy, a service not wired up yet) must never blank what is
 * already there.
 */
const stackOwns = (key) =>
  Boolean(resolvedValues[key]) && (stackManaged.has(key) || MINTED_AWS_CREDENTIAL.test(key));

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
      !stackOwns(key) && existingValues[key] ? existingValues[key] : value,
    ]),
  );
  // Say which values this kept instead of the stack's.
  //
  // What is left after `stackOwns` are the ones a person is expected to choose
  // -- `DATABASE_URL`, a personal Stripe test key, an `APP_HOST` pointing at
  // localhost -- so keeping them is right and this line is a receipt, not a
  // warning. It matters for the residue: values the stack also writes that are
  // *not* credentials (a RUM monitor id, a log group name). A stale one of
  // those is silent in the file and surfaces much later somewhere else, which
  // is exactly how a hand-typed `PLACES_AWS_ACCESS_KEY_ID` reached production.
  const kept = Object.keys(resolvedValues).filter(
    (key) =>
      !stackOwns(key) &&
      existingValues[key] &&
      resolvedValues[key] &&
      existingValues[key] !== resolvedValues[key],
  );
  if (kept.length > 0) {
    console.warn(
      `Kept the value already in ${outputPath} for ${kept.join(", ")} -- the deployed stack has a different one. Blank the line and re-run to take the stack's.`,
    );
  }
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
