import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { areas, shared } from "./task-context-data.mjs";

const ROOT = process.cwd();

function usage() {
  console.error(
    `Usage: pnpm task:context -- <area>\nAreas: ${Object.keys(areas).sort().join(", ")}`,
  );
  process.exit(1);
}

const areaName = process.argv[2];
if (!areaName || !areas[areaName]) usage();
const area = areas[areaName];

async function annotate(items) {
  return Promise.all(
    items.map(async (item) => {
      try {
        await access(path.join(ROOT, item));
        return item;
      } catch {
        return `${item} (planned or not present yet)`;
      }
    }),
  );
}

const sections = [
  ["Goal", [area.goal]],
  ["Read", await annotate(area.docs)],
  ["Likely code", await annotate(area.code)],
  ["Tests as specification", await annotate(area.tests)],
  ["Invariants", area.invariants],
  ["Focused validation", area.validate],
  ["Do not read", shared.avoid],
  ["Working rules", shared.rules],
];

console.log(`# Task context: ${areaName}`);
for (const [heading, items] of sections) {
  console.log(`\n## ${heading}`);
  for (const item of items) console.log(`- ${item}`);
}
