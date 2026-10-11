import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { areas, shared } from "./task-context-data.mjs";

/** The listing `pnpm task:context` prints with no area: every area and its goal, sorted. */
export function areaList(all = areas) {
  const names = Object.keys(all).sort();
  const width = Math.max(...names.map((name) => name.length)) + 2;
  return [
    "Usage: pnpm task:context <area>",
    "",
    ...names.map((name) => `${name.padEnd(width)}${all[name].goal}`),
  ].join("\n");
}

async function annotate(root, items) {
  return Promise.all(
    items.map(async (item) => {
      try {
        await access(path.join(root, item));
        return item;
      } catch {
        return `${item} (planned or not present yet)`;
      }
    }),
  );
}

/** The context block for one area, as printed. */
export async function renderArea(root, areaName, area = areas[areaName]) {
  const sections = [
    ["Goal", [area.goal]],
    ["Read", await annotate(root, area.docs)],
    ["Likely code", await annotate(root, area.code)],
    ["Tests as specification", await annotate(root, area.tests)],
    ["Invariants", area.invariants],
    ["Focused validation", area.validate],
    ["Do not read", shared.avoid],
    ["Working rules", shared.rules],
  ];
  const lines = [`# Task context: ${areaName}`];
  for (const [heading, items] of sections) {
    lines.push("", `## ${heading}`, ...items.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const areaName = process.argv[2];
  if (!areaName) {
    console.log(areaList());
  } else if (!areas[areaName]) {
    console.error(`No area "${areaName}".\n\n${areaList()}`);
    process.exit(1);
  } else {
    console.log(await renderArea(process.cwd(), areaName));
  }
}
