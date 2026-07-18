import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const markdownLink = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;

async function walk(relativeDirectory) {
  const entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (entry.name.endsWith(".md")) files.push(relativePath);
  }
  return files;
}

function targetPath(source, rawTarget) {
  const target = rawTarget.split("#", 1)[0].split("?", 1)[0];
  if (
    !target ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:")
  )
    return null;
  return path.normalize(path.join(path.dirname(source), decodeURIComponent(target)));
}

const broken = [];
const files = ["README.md", "AGENTS.md", ...(await walk("docs"))];
for (const file of files) {
  const contents = await readFile(path.join(ROOT, file), "utf8");
  for (const match of contents.matchAll(markdownLink)) {
    const target = targetPath(file, match[1]);
    if (!target) continue;
    try {
      await access(path.join(ROOT, target));
    } catch {
      broken.push(`${file}: ${match[1]} -> ${target}`);
    }
  }
}

if (broken.length > 0) {
  console.error(
    "Broken internal documentation links:\n" + broken.map((item) => `- ${item}`).join("\n"),
  );
  process.exit(1);
}

console.log(`docs: ${files.length} Markdown files have valid internal links`);
