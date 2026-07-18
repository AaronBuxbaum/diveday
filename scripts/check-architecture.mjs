import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const guardedRoots = ["src/lib", "src/features"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

function importsApp(importer, specifier) {
  if (specifier === "@/app" || specifier.startsWith("@/app/")) return true;
  if (!specifier.startsWith(".")) return false;

  const resolved = path.normalize(path.join(path.dirname(importer), specifier));
  return (
    resolved === path.normalize("src/app") ||
    resolved.startsWith(`${path.normalize("src/app")}${path.sep}`)
  );
}

const violations = [];
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const contents = await readFile(path.join(ROOT, file), "utf8");
    for (const match of contents.matchAll(importPattern)) {
      if (importsApp(file, match[1])) violations.push(`${file}: imports ${match[1]}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `Architecture boundary violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
  console.error(
    "Domain code must not import from src/app. Move shared behavior into src/lib or a feature module.",
  );
  process.exit(1);
}

console.log("architecture: boundaries valid");
