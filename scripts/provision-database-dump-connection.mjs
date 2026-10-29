#!/usr/bin/env node
// Fill the pg_dump secret from Neon's Management API after an infra deployment. The URI is
// retrieved directly from Neon, masked in the workflow, held in process memory, and passed to the
// AWS CLI through a short-lived mode-0600 file rather than argv or CloudFormation state.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { PRIMARY_REGION } from "../config/aws-regions.mjs";
import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const SECRET_ID = "diveday/database-url-unpooled";
const NEON_API_ORIGIN = "https://console.neon.tech";
const NEON_API_TIMEOUT_MS = 30_000;

export function connectionUriRequestUrl(projectId) {
  const id = String(projectId ?? "").trim();
  if (!/^[a-z0-9-]{1,60}$/.test(id)) {
    throw new Error("NEON_PROJECT_ID must be a Neon project ID.");
  }
  const url = new URL(`/api/v2/projects/${encodeURIComponent(id)}/connection_uri`, NEON_API_ORIGIN);
  url.searchParams.set("pooled", "false");
  return url;
}

export function isDirectConnectionUri(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return false;
  try {
    const uri = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(uri.protocol) &&
      Boolean(uri.hostname && uri.username && uri.password) &&
      !uri.hostname.toLowerCase().includes("-pooler")
    );
  } catch {
    return false;
  }
}

export function shouldUpdateConnectionUri(current, desired) {
  return typeof current !== "string" || current.trim() !== desired;
}

async function fetchDirectConnectionUri(apiKey, projectId) {
  const response = await fetch(connectionUriRequestUrl(projectId), {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(NEON_API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Neon API returned HTTP ${response.status} while retrieving the dump connection.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Neon API returned an invalid connection response.");
  }
  if (!isDirectConnectionUri(payload?.uri)) {
    throw new Error("Neon API did not return a direct PostgreSQL connection URI.");
  }
  return payload.uri;
}

function maskInGitHub(uri) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const password = new URL(uri).password;
  if (password) console.log(`::add-mask::${decodeURIComponent(password)}`);
  console.log(`::add-mask::${uri}`);
}

function awsEnvironment() {
  const env = { ...process.env };
  delete env.NEON_API_KEY;
  delete env.NEON_PROJECT_ID;
  return env;
}

function readStoredConnectionUri() {
  try {
    return readBounded(
      "aws",
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        SECRET_ID,
        "--query",
        "SecretString",
        "--output",
        "text",
        "--region",
        PRIMARY_REGION,
      ],
      { encoding: "utf8", env: awsEnvironment(), timeoutMs: SUBPROCESS_TIMEOUTS.awsApi },
    ).trim();
  } catch {
    throw new Error("Could not read the database dump secret from Secrets Manager.");
  }
}

function writeConnectionUri(uri) {
  const directory = mkdtempSync(join(tmpdir(), "diveday-dump-connection-"), { mode: 0o700 });
  const secretFile = join(directory, "connection-uri");
  try {
    writeFileSync(secretFile, uri, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const result = runBounded(
      "aws",
      [
        "secretsmanager",
        "put-secret-value",
        "--secret-id",
        SECRET_ID,
        "--secret-string",
        `file://${secretFile}`,
        "--region",
        PRIMARY_REGION,
      ],
      {
        env: awsEnvironment(),
        stdio: ["ignore", "ignore", "ignore"],
        timeoutMs: SUBPROCESS_TIMEOUTS.awsApi,
      },
    );
    if (result.status !== 0) throw new Error("AWS rejected the database dump secret update.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeGitHubOutput(key, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (path) writeFileSync(path, `${key}=${value}\n`, { encoding: "utf8", flag: "a", mode: 0o600 });
}

export async function provisionDatabaseDumpConnection({ apiKey, projectId }) {
  if (!String(apiKey ?? "").trim()) throw new Error("NEON_API_KEY is required.");
  const uri = await fetchDirectConnectionUri(apiKey.trim(), projectId);
  maskInGitHub(uri);

  const current = readStoredConnectionUri();
  const firstSeed = current === "unset" || current === "";
  if (shouldUpdateConnectionUri(current, uri)) {
    writeConnectionUri(uri);
    console.log("database-dump-connection: updated the Secrets Manager value.");
  } else {
    console.log("database-dump-connection: Secrets Manager already has the current URI.");
  }
  writeGitHubOutput("changed", shouldUpdateConnectionUri(current, uri));
  writeGitHubOutput("first_seed", firstSeed);
  return { changed: shouldUpdateConnectionUri(current, uri), firstSeed };
}

async function main() {
  try {
    await provisionDatabaseDumpConnection({
      apiKey: process.env.NEON_API_KEY,
      projectId: process.env.NEON_PROJECT_ID,
    });
  } catch (error) {
    // API bodies, AWS stderr and connection values can all contain sensitive data; report a
    // bounded reason selected above, never a vendor response or the URI itself.
    console.error(`database-dump-connection: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
