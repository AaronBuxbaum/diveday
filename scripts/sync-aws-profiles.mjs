#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDotenv } from "./dotenv.mjs";

const repairConfigOnly = process.argv.includes("--repair-config");
const checkOnly = process.argv.includes("--check");
const source = repairConfigOnly ? "" : readFileSync(0, "utf8");
const awsDirectory = process.env.AWS_PROFILE_HOME?.trim() || join(homedir(), ".aws");
const credentialsPath = join(awsDirectory, "credentials");
const configPath = join(awsDirectory, "config");
const iniSection = /^\[([^\]]+)\]$/;
const iniValue = /^\s*([a-z_]+)\s*=\s*(.*)$/;

const values = parseDotenv(source);

function commentedIni(document) {
  const profiles = new Map();
  let profile;
  for (const rawLine of document.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*#\s?/, "").trim();
    const section = line.match(iniSection);
    if (section) {
      profile = section[1];
      profiles.set(profile, {});
      continue;
    }
    const value = line.match(iniValue);
    if (profile && value) profiles.get(profile)[value[1]] = value[2];
  }
  return profiles;
}

function credentials(accessKeyId, secretAccessKey) {
  return accessKeyId && secretAccessKey
    ? { aws_access_key_id: accessKeyId, aws_secret_access_key: secretAccessKey }
    : undefined;
}

const commentedProfiles = commentedIni(source);
const managedProfiles = new Map(
  [
    ["diveday-deployer", commentedProfiles.get("diveday-deployer")],
    [
      "reg-suit-bot",
      credentials(values.REG_SUIT_AWS_ACCESS_KEY_ID, values.REG_SUIT_AWS_SECRET_ACCESS_KEY),
    ],
    [
      "diveday-ses-sender",
      credentials(values.SES_AWS_ACCESS_KEY_ID, values.SES_AWS_SECRET_ACCESS_KEY),
    ],
    [
      "diveday-sns-sms-sender",
      credentials(values.SNS_AWS_ACCESS_KEY_ID, values.SNS_AWS_SECRET_ACCESS_KEY),
    ],
    [
      "diveday-places-lookup",
      credentials(values.PLACES_AWS_ACCESS_KEY_ID, values.PLACES_AWS_SECRET_ACCESS_KEY),
    ],
    ["diveday-backup-uploader", commentedProfiles.get("diveday-backup-uploader")],
  ].filter(([, profile]) => profile?.aws_access_key_id && profile?.aws_secret_access_key),
);

function parseIni(document) {
  const preamble = [];
  const sections = new Map();
  let current;

  for (const line of document.split(/\r?\n/)) {
    const section = line.match(iniSection);
    if (section) {
      current = sections.get(section[1]) ?? new Map();
      sections.set(section[1], current);
      continue;
    }
    const value = line.match(iniValue);
    if (current && value) current.set(value[1], value[2]);
    else if (!current && line.trim()) preamble.push(line);
  }
  return { preamble, sections };
}

function renderIni(path, replacements) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const { preamble, sections } = parseIni(existing);
  for (const [name, entries] of replacements) {
    const merged = sections.get(name) ?? new Map();
    for (const [key, value] of Object.entries(entries)) merged.set(key, value);
    sections.set(name, merged);
  }

  return [
    preamble.join("\n"),
    ...[...sections].map(([name, entries]) =>
      [`[${name}]`, ...[...entries].map(([key, value]) => `${key} = ${value}`)].join("\n"),
    ),
    "",
  ].join("\n\n");
}

function updateIni(path, replacements) {
  const rendered = renderIni(path, replacements);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, rendered, { mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

const configReplacements = new Map([
  ["profile diveday-admin", { region: "us-east-1" }],
  ...[...managedProfiles.keys()].map((profile) => [`profile ${profile}`, { region: "us-east-1" }]),
]);

if (checkOnly) {
  const credentialsCurrent = repairConfigOnly
    ? true
    : existsSync(credentialsPath) &&
      readFileSync(credentialsPath, "utf8") === renderIni(credentialsPath, managedProfiles);
  const configCurrent =
    existsSync(configPath) &&
    readFileSync(configPath, "utf8") === renderIni(configPath, configReplacements);
  console.log(credentialsCurrent && configCurrent ? "CURRENT" : "UPDATE");
  process.exit(0);
}

mkdirSync(awsDirectory, { recursive: true, mode: 0o700 });
if (!repairConfigOnly) updateIni(credentialsPath, managedProfiles);
// The administrator credential predates this stack, so this only establishes
// its profile's region and never invents or copies administrator key material.
updateIni(configPath, configReplacements);
console.log(`Updated ${managedProfiles.size} generated AWS profiles in ${credentialsPath}.`);
