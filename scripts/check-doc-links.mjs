import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const markdownLink = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
const headingLine = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

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

/**
 * GitHub's heading-anchor slug: strip inline markup, drop everything that is not
 * alphanumeric/space/hyphen/underscore, lowercase, then spaces to hyphens. A doc
 * link to `roadmap.md#gift-cards` is as broken as one to a deleted file — it
 * lands the next agent at the top of a long page with no clue what it wanted —
 * so both are the same failure here.
 */
function anchorSlug(headingText) {
  return headingText
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-_]/gu, "")
    .trim()
    .replace(/ /g, "-");
}

function anchorsIn(contents) {
  const anchors = new Set();
  let inFence = false;
  for (const line of contents.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = headingLine.exec(line);
    if (heading) anchors.add(anchorSlug(heading[2]));
    // Explicit HTML anchors (`<a id="...">` / `<a name="...">`) count too.
    for (const explicit of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(explicit[1]);
  }
  return anchors;
}

const broken = [];
const files = [
  "README.md",
  "AGENTS.md",
  ...(await walk("docs")),
  ...(await walk(".claude/skills")),
];

const contentsByFile = new Map();
for (const file of files) {
  contentsByFile.set(file, await readFile(path.join(ROOT, file), "utf8"));
}
const anchorsByFile = new Map();
function anchorsFor(file) {
  if (!anchorsByFile.has(file)) anchorsByFile.set(file, anchorsIn(contentsByFile.get(file)));
  return anchorsByFile.get(file);
}

let anchorLinks = 0;
for (const file of files) {
  for (const match of contentsByFile.get(file).matchAll(markdownLink)) {
    const raw = match[1];
    const target = targetPath(file, raw);
    if (!target) continue;
    try {
      await access(path.join(ROOT, target));
    } catch {
      broken.push(`${file}: ${raw} -> ${target}`);
      continue;
    }
    const fragment = raw.split("#").slice(1).join("#");
    // Only Markdown targets we already read have anchors to verify.
    if (!fragment || !contentsByFile.has(target)) continue;
    anchorLinks += 1;
    if (!anchorsFor(target).has(decodeURIComponent(fragment))) {
      broken.push(`${file}: ${raw} -> no heading "#${fragment}" in ${target}`);
    }
  }
}

if (broken.length > 0) {
  console.error(
    `Broken internal documentation links:\n${broken.map((item) => `- ${item}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `docs: ${files.length} Markdown files have valid internal links (${anchorLinks} with a verified heading anchor)`,
);
