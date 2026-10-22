import { existsSync, readFileSync } from "node:fs";
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
    [
      "Read",
      await annotate(
        root,
        area.docs.filter((item) => !BROAD_DOCS.has(item)),
      ),
    ],
    [
      "Optional reference (search relevant headings only)",
      area.docs.filter((item) => BROAD_DOCS.has(item)),
    ],
    [
      "Likely code",
      await annotate(
        root,
        area.code.filter((item) => !BROAD_PATHS.has(item)),
      ),
    ],
    [
      "Tests as specification",
      await annotate(
        root,
        area.tests.filter((item) => !BROAD_PATHS.has(item)),
      ),
    ],
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

const BROAD_DOCS = new Set([
  "docs/product/features/roadmap.md",
  "docs/product/glossary.md",
  "docs/design/principles.md",
  "docs/architecture/overview.md",
]);
const BROAD_PATHS = new Set(["src/app", "src/lib", "src/components", "e2e", "src/db/schema/"]);

export function matchAreas(file, all = areas) {
  const normalized = file.replace(/^\.\//, "");
  const ranked = Object.entries(all)
    .map(([name, area]) => {
      const score = [...area.code, ...area.tests].reduce((best, item) => {
        const prefix = item.replace(/\/$/, "");
        return !BROAD_PATHS.has(item) &&
          (normalized === prefix || normalized.startsWith(`${prefix}/`))
          ? Math.max(best, prefix.length)
          : best;
      }, 0);
      return { name, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (!ranked.length && /^(src\/components\/|src\/app\/)/.test(normalized)) return ["design"];
  return ranked
    .filter(({ score }) => score === ranked[0]?.score)
    .slice(0, 3)
    .map(({ name }) => name);
}

export function recipePacket(root, slug) {
  const indexPath = path.join(root, "docs/design/recipes/index.json");
  const recipes = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!Object.hasOwn(recipes, slug)) throw new Error(`Unknown recipe: ${slug}`);
  return {
    id: slug,
    ...recipes[slug],
    planCommand: `node scripts/visual-recipes.mjs ${slug} --plan`,
  };
}

export function recipeForPath(file) {
  if (/help-request|DaySpine|handoff/i.test(file)) return "handoff";
  if (/settings.*Rail|settings\//i.test(file)) return "settings";
  if (/Toast|feedback/i.test(file)) return "feedback";
  if (/RowMenu|menu|row-action/i.test(file)) return "row-actions";
  if (/^(src\/components\/|src\/app\/)/.test(file)) return "forms";
  return null;
}

export function pathPacket(root, file) {
  if (path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))
    throw new Error("Use a repository-relative path without traversal");
  file = file.replace(/^\.\//, "");
  const matches = matchAreas(file);
  const recipe = recipeForPath(file);
  const test = file.replace(/\.(tsx?|mjs)$/, ".test.$1");
  const rules = file.startsWith("src/db/")
    ? ["db", "domain"]
    : file.startsWith("src/i18n/")
      ? ["i18n"]
      : file.startsWith("src/app/") || file.startsWith("src/components/")
        ? ["surfaces", "i18n"]
        : file.startsWith("e2e/")
          ? ["e2e"]
          : file.startsWith("docs/")
            ? ["docs"]
            : file.startsWith("src/lib/") || file.startsWith("src/features/")
              ? ["domain"]
              : file.startsWith("infra/")
                ? ["infra"]
                : ["scripts"];
  return {
    path: file,
    exists: existsSync(path.join(root, file)),
    areas: matches,
    read: rules.map((rule) => `.claude/rules/${rule}.md`),
    tests: existsSync(path.join(root, test))
      ? [test]
      : [
          ...new Set(
            matches.flatMap((name) => areas[name].tests.filter((item) => !BROAD_PATHS.has(item))),
          ),
        ].slice(0, 6),
    invariants: [...new Set(matches.flatMap((name) => areas[name].invariants))],
    decisions:
      "Read .agent-out/task-state/<branch>.json decisions; search relevant entries in docs/product/human-decisions/ before reopening a settled decision.",
    visual: recipe ? recipePacket(root, recipe) : null,
    fallback: matches.length
      ? null
      : "No exact area: consult docs/agents/route-map.md; do not read broad directories whole.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const areaName = process.argv[2];
  if (areaName === "--path") {
    if (!process.argv[3]) throw new Error("--path needs a repository-relative path");
    console.log(JSON.stringify(pathPacket(process.cwd(), process.argv[3]), null, 2));
  } else if (areaName === "--recipe") {
    const recipe = process.argv[3];
    if (!recipe || !/^[a-z0-9-]+$/.test(recipe)) throw new Error("--recipe needs a recipe slug");
    console.log(JSON.stringify(recipePacket(process.cwd(), recipe), null, 2));
  } else if (!areaName) {
    console.log(areaList());
  } else if (!areas[areaName]) {
    console.error(`No area "${areaName}".\n\n${areaList()}`);
    process.exit(1);
  } else {
    console.log(await renderArea(process.cwd(), areaName));
  }
}
