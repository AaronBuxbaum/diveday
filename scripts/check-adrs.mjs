import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const directory = path.join(process.cwd(), "docs/architecture/decisions");
const entries = (await readdir(directory)).filter(
  (name) => name.endsWith(".md") && name !== "README.md" && name !== "0000-template.md",
);
const validId = /^(?:\d{4}|\d{8})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validStatuses = new Set(["Proposed", "Accepted", "Deprecated", "Superseded"]);
const requiredSections = ["Context", "Decision", "Alternatives considered", "Consequences"];
const ids = new Map();
const failures = [];

for (const filename of entries) {
  const id = filename.slice(0, -3);
  const contents = await readFile(path.join(directory, filename), "utf8");
  const heading = contents.match(/^#\s+([^\s]+)\s+[—-]\s+.+$/m)?.[1];
  const status = contents.match(/^- \*\*Status:\*\*\s+([^\n]+)$/m)?.[1]?.trim();

  if (!validId.test(id)) failures.push(`${filename}: id must be NNNN-slug (historical) or YYYYMMDD-slug (new)`);
  if (heading !== id) failures.push(`${filename}: heading id must be ${id}`);
  if (!status || ![...validStatuses].some((candidate) => status.startsWith(candidate))) {
    failures.push(`${filename}: status must begin with ${[...validStatuses].join(", ")}`);
  }
  if (!/^- \*\*Date:\*\*\s+\d{4}-\d{2}-\d{2}$/m.test(contents)) {
    failures.push(`${filename}: missing ISO Date metadata`);
  }
  for (const section of requiredSections) {
    if (!contents.includes(`## ${section}`)) failures.push(`${filename}: missing section “${section}”`);
  }

  const duplicates = ids.get(id) ?? [];
  duplicates.push(filename);
  ids.set(id, duplicates);
}

for (const [id, filenames] of ids) {
  if (filenames.length > 1) failures.push(`duplicate ADR id ${id}: ${filenames.join(", ")}`);
}

if (failures.length > 0) {
  console.error("ADR validation failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`adrs: ${entries.length} records valid`);
