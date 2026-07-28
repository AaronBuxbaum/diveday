import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const roots = ["src", "scripts", "e2e"];
const sourceExtensions = new Set([".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const decoder = new TextDecoder("utf-8", { fatal: true });

async function walk(relativeDirectory) {
  const entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const violations = [];
for (const root of roots) {
  for (const file of await walk(root)) {
    const bytes = await readFile(path.join(ROOT, file));
    if (bytes.includes(0)) violations.push(`${file}: contains a NUL byte`);
    try {
      decoder.decode(bytes);
    } catch {
      violations.push(`${file}: is not valid UTF-8`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Source text integrity violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  process.exit(1);
}

console.log("source-text: source files are valid UTF-8 without NUL bytes");
